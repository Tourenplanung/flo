import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Connection,
  type Edge,
  type EdgeChange,
  type IsValidConnection,
  type NodeChange,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useCallback, useMemo, useRef, useState } from 'react';
import { createId } from '@/core/ids';
import type { Workflow } from '@/core/schema';
import { CATEGORIES, getSpec, PORT_COLORS } from '@/core/workflow/catalog';
import { outputPort, validateConnection } from '@/core/workflow/graph';
import { addNode } from '@/editor/workflowActions';
import { dispatch } from '@/store/docStore';
import { useEditorStore } from '@/store/editorStore';
import { useWorkflowStore } from '@/store/workflowStore';
import { FloNode, type FloFlowNode } from './FloNode';

export const PALETTE_MIME = 'application/x-flo-node-kind';

const nodeTypes = { flo: FloNode };

let dragSeq = 0;

function Flow({ workflow }: { workflow: Workflow }) {
  const selectedNodeId = useWorkflowStore((s) => s.selectedNodeId);
  const running = useWorkflowStore((s) => s.running);
  const statuses = useWorkflowStore((s) => s.statuses);
  const { screenToFlowPosition } = useReactFlow();
  const dragKey = useRef<Record<string, string>>({});
  // Measured node sizes reported by React Flow (UI state only, needed by minimap/fitView/edges).
  const [measured, setMeasured] = useState<Record<string, { width: number; height: number }>>({});

  const nodes: FloFlowNode[] = useMemo(
    () =>
      workflow.nodes.map((n) => ({
        id: n.id,
        type: 'flo' as const,
        position: n.position,
        selected: n.id === selectedNodeId,
        measured: measured[n.id],
        data: { workflowId: workflow.id, kind: n.kind, label: n.label },
      })),
    [workflow, selectedNodeId, measured],
  );

  const edges: Edge[] = useMemo(
    () =>
      workflow.edges.map((e) => {
        const type = outputPort(workflow, e.source, e.sourcePort)?.type ?? 'any';
        return {
          id: e.id,
          source: e.source,
          sourceHandle: e.sourcePort,
          target: e.target,
          targetHandle: e.targetPort,
          animated: running && statuses[e.target] === 'running',
          style: { stroke: PORT_COLORS[type], strokeWidth: 2, opacity: statuses[e.source] === 'skipped' ? 0.3 : 0.9 },
        };
      }),
    [workflow, running, statuses],
  );

  const onNodesChange = useCallback(
    (changes: NodeChange<FloFlowNode>[]) => {
      const removed = changes.filter((c) => c.type === 'remove').map((c) => c.id);
      if (removed.length) {
        dispatch([{ type: 'removeWorkflowNodes', workflowId: workflow.id, ids: removed }], { label: 'Delete workflow nodes' });
        if (removed.includes(useWorkflowStore.getState().selectedNodeId ?? '')) useWorkflowStore.getState().selectNode(null);
      }
      const dims = changes.filter((c) => c.type === 'dimensions' && c.dimensions);
      if (dims.length) {
        setMeasured((m) => {
          const next = { ...m };
          for (const c of dims) if (c.type === 'dimensions' && c.dimensions) next[c.id] = c.dimensions;
          return next;
        });
      }
      for (const c of changes) {
        if (c.type === 'position' && c.position) {
          dragKey.current[c.id] ??= `wfdrag-${c.id}-${++dragSeq}`;
          dispatch(
            [{ type: 'updateWorkflowNode', workflowId: workflow.id, id: c.id, props: { position: { x: Math.round(c.position.x), y: Math.round(c.position.y) } } }],
            { label: 'Move workflow node', mergeKey: dragKey.current[c.id], mergeWindow: Infinity },
          );
          if (!c.dragging) delete dragKey.current[c.id];
        } else if (c.type === 'position' && c.dragging === false) delete dragKey.current[c.id];
        if (c.type === 'select' && c.selected) useWorkflowStore.getState().selectNode(c.id);
      }
    },
    [workflow.id],
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      const removed = changes.filter((c) => c.type === 'remove').map((c) => c.id);
      if (removed.length) dispatch([{ type: 'removeWorkflowEdges', workflowId: workflow.id, ids: removed }], { label: 'Delete connections' });
    },
    [workflow.id],
  );

  const onConnect = useCallback(
    (c: Connection) => {
      if (!c.sourceHandle || !c.targetHandle) return;
      const edge = { id: createId(), source: c.source, sourcePort: c.sourceHandle, target: c.target, targetPort: c.targetHandle };
      const res = dispatch([{ type: 'addWorkflowEdge', workflowId: workflow.id, edge }], { label: 'Connect' });
      if (!res.ok) useEditorStore.getState().showToast(res.error, 'error');
      else useWorkflowStore.getState().markStale(workflow.id, c.target);
    },
    [workflow.id],
  );

  const isValidConnection: IsValidConnection = useCallback(
    (c) =>
      !!c.sourceHandle &&
      !!c.targetHandle &&
      validateConnection(workflow, { source: c.source, sourcePort: c.sourceHandle, target: c.target, targetPort: c.targetHandle }) === null,
    [workflow],
  );

  return (
    <div
      className="h-full w-full"
      data-testid="workflow-canvas"
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes(PALETTE_MIME)) {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'copy';
        }
      }}
      onDrop={(e) => {
        const kind = e.dataTransfer.getData(PALETTE_MIME);
        if (!kind || !getSpec(kind)) return;
        e.preventDefault();
        const p = screenToFlowPosition({ x: e.clientX, y: e.clientY });
        addNode(workflow.id, kind, { x: Math.round(p.x - 112), y: Math.round(p.y - 20) });
      }}
    >
      <ReactFlow<FloFlowNode>
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        isValidConnection={isValidConnection}
        onPaneClick={() => useWorkflowStore.getState().selectNode(null)}
        colorMode="dark"
        fitView
        fitViewOptions={{ padding: 0.2, maxZoom: 1 }}
        minZoom={0.1}
        deleteKeyCode={['Backspace', 'Delete']}
        defaultEdgeOptions={{ type: 'smoothstep' }}
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="#2a2c35" />
        <Controls showInteractive={false} />
        <MiniMap
          pannable
          zoomable
          nodeColor={(n) => CATEGORIES.find((c) => c.id === getSpec((n.data as { kind: string }).kind)?.category)?.color ?? '#555'}
          maskColor="rgba(11,12,16,0.7)"
          style={{ background: '#13141a' }}
        />
      </ReactFlow>
    </div>
  );
}

export function FlowCanvas({ workflow }: { workflow: Workflow }) {
  return (
    <ReactFlowProvider key={workflow.id}>
      <Flow workflow={workflow} />
    </ReactFlowProvider>
  );
}

export { addNode };
