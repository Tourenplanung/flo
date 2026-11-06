/**
 * Static React → flö importer.
 *
 * Source files are parsed with @babel/parser and *interpreted symbolically*: nothing from the
 * imported code is ever executed. A tiny evaluator understands the subset of JavaScript that
 * typical presentational components use (literals, props with defaults, `cn/clsx/cva`,
 * `.map` over constant arrays, conditionals, local components) and treats everything else as
 * an unknown placeholder. The resulting element tree is converted to plain flö layers
 * (frames with auto layout, text, icons, image placeholders) with Tailwind classes and inline
 * styles mapped to editable properties. Mobile-first Tailwind (`md:` …) becomes a desktop
 * base with `bp-mobile` responsive overrides.
 */
import { parse } from '@babel/parser';
import type * as t from '@babel/types';
import { createFrame, createIcon, createImage, createLine, createRect, createText, solid, type NodeTree } from '../factory';
import { ICON_NAMES, type DesignNode, type Effect, type FrameNode, type IconName, type Paint, type TextNode } from '../schema';
import { lucideName } from '../export/icons';
import { applyInlineStyle, INHERITED, parseClasses, type StyleSpec } from './tailwind';

/* ------------------------------------------------------------------ */
/* Values of the symbolic evaluator                                    */
/* ------------------------------------------------------------------ */

class Unknown {
  constructor(public label: string) {}
}
interface Fn {
  kind: 'fn';
  name?: string;
  params: t.Node[];
  body: t.Node;
  env: Env;
}
interface Builtin {
  kind: 'builtin';
  name: string;
  call: (args: V[]) => V;
}
interface Cva {
  kind: 'cva';
  base: string;
  variants: Record<string, Record<string, string>>;
  defaults: Record<string, string>;
}
interface El {
  kind: 'el';
  tag: string | Fn | IconRef | ExtRef;
  props: Record<string, V>;
  children: V[];
}
interface IconRef {
  kind: 'icon';
  icon: IconName | null;
  name: string;
}
interface ExtRef {
  kind: 'ext';
  name: string;
}
type V = string | number | boolean | null | undefined | Unknown | V[] | { [k: string]: V } | Fn | Builtin | Cva | El | IconRef | ExtRef;

const isObj = (v: V): v is { [k: string]: V } => !!v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Unknown) && !('kind' in v && typeof (v as { kind: unknown }).kind === 'string' && KINDS.has((v as { kind: string }).kind));
const KINDS = new Set(['fn', 'builtin', 'cva', 'el', 'icon', 'ext']);
const isKind = <K extends string>(v: V, k: K): boolean => !!v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Unknown) && (v as { kind?: unknown }).kind === k;

class Env {
  private vars = new Map<string, V>();
  constructor(private parent?: Env) {}
  has(name: string): boolean {
    return this.vars.has(name) || !!this.parent?.has(name);
  }
  get(name: string): V {
    if (this.vars.has(name)) return this.vars.get(name);
    if (this.parent) return this.parent.get(name);
    return new Unknown(name);
  }
  set(name: string, v: V) {
    this.vars.set(name, v);
  }
}

/* ------------------------------------------------------------------ */
/* Public types                                                        */
/* ------------------------------------------------------------------ */

export interface SourceFile {
  path: string;
  code: string;
}

export interface ComponentInfo {
  name: string;
  file: string;
  exported: boolean;
  /** cva variant axis rendered as separate components (e.g. `variant`). */
  variantKey?: string;
  variantValues?: string[];
}

export interface ConvertedComponent {
  name: string;
  file: string;
  variant: Record<string, string>;
  tree: NodeTree;
  width: number;
  height: number;
}

export interface ConvertOptions {
  /** Max nodes per component (safety limit). */
  maxNodes?: number;
  lang?: 'it' | 'en';
}

const MAX_FILE_BYTES = 300_000;
const MAX_STEPS = 200_000;
const MAX_DEPTH = 30;

const CLASS_HELPERS = new Set(['cn', 'clsx', 'classNames', 'classnames', 'cx', 'twMerge', 'twJoin']);
const ICON_BY_LUCIDE: Record<string, IconName> = Object.fromEntries(ICON_NAMES.map((n) => [lucideName(n), n]));
// Common lucide aliases / renamed exports.
Object.assign(ICON_BY_LUCIDE, {
  Home: 'home',
  House: 'home',
  Share: 'share',
  Share2: 'share',
  AlertTriangle: 'alert-triangle',
  TriangleAlert: 'alert-triangle',
  LayoutGrid: 'layout',
  Layout: 'layout',
  ShoppingBag: 'shopping-cart',
  MapPinned: 'map-pin',
  ChevronDown: 'chevron-down',
  ChevronRight: 'chevron-right',
  CheckCircle: 'check',
  CircleCheck: 'check',
  XIcon: 'x',
  CheckIcon: 'check',
  Sparkle: 'sparkles',
  Settings2: 'settings',
  Image: 'image',
  ImageIcon: 'image',
  Mail: 'mail',
  User: 'user',
  UserRound: 'user',
  Users: 'users',
  Globe2: 'globe',
  Earth: 'globe',
  Lock: 'lock',
  LockKeyhole: 'lock',
  Calendar: 'calendar',
  CalendarDays: 'calendar',
  Clock: 'clock',
  Clock3: 'clock',
  ArrowUpRight: 'arrow-up-right',
  ExternalLink: 'arrow-up-right',
  MenuIcon: 'menu',
  SearchIcon: 'search',
  PlayCircle: 'play',
  Zap: 'zap',
  Bolt: 'zap',
} satisfies Record<string, IconName>);

function iconFromImport(source: string, imported: string): IconRef | null {
  if (source === 'lucide-react' || source.startsWith('lucide-react/')) {
    const base = imported.replace(/Icon$/, '').replace(/^Lucide/, '');
    return { kind: 'icon', icon: ICON_BY_LUCIDE[imported] ?? ICON_BY_LUCIDE[base] ?? null, name: imported };
  }
  if (source.startsWith('@heroicons/react') || source.startsWith('@radix-ui/react-icons') || source.startsWith('react-icons') || source.startsWith('@tabler/icons-react') || source.startsWith('@phosphor-icons/react')) {
    const base = imported.replace(/Icon$/, '').replace(/^(Icon|Fi|Fa|Md|Hi|Io|Ri|Bi|Bs|Ai|Tb|Lu)(?=[A-Z])/, '');
    const kebab = base.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
    const direct = (ICON_NAMES as readonly string[]).includes(kebab) ? (kebab as IconName) : null;
    return { kind: 'icon', icon: direct ?? ICON_BY_LUCIDE[base] ?? null, name: imported };
  }
  return null;
}

const humanize = (s: string) =>
  s
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/^./, (c) => c.toUpperCase())
    .trim() || 'Testo';

/* ------------------------------------------------------------------ */
/* Importer                                                            */
/* ------------------------------------------------------------------ */

interface ModuleInfo {
  path: string;
  env: Env;
  exported: Set<string>;
  defaultName?: string;
  tailwind: boolean;
  ast: t.File;
}

export class ReactImporter {
  readonly errors: string[] = [];
  private modules: ModuleInfo[] = [];
  private global = new Map<string, { value: V; module: ModuleInfo }>();
  private steps = 0;
  private warnings = new Set<string>();
  private unknownClasses = new Set<string>();
  private lang: 'it' | 'en';
  private maxNodes: number;
  private count = 0;

  constructor(files: SourceFile[], opts: ConvertOptions = {}) {
    this.lang = opts.lang ?? 'it';
    this.maxNodes = opts.maxNodes ?? 1500;
    for (const f of files) {
      if (f.code.length > MAX_FILE_BYTES) {
        this.errors.push(`${f.path}: ${this.msg('file troppo grande', 'file too large')}`);
        continue;
      }
      try {
        const ast = parse(f.code, { sourceType: 'module', plugins: ['jsx', 'typescript'], errorRecovery: true });
        this.modules.push({ path: f.path, env: new Env(), exported: new Set(), tailwind: /className\s*=/.test(f.code), ast });
      } catch (e) {
        this.errors.push(`${f.path}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    for (const m of this.modules) this.loadModule(m);
  }

  private msg(it: string, en: string) {
    return this.lang === 'it' ? it : en;
  }

  /* ---------------- module loading ---------------- */

  private loadModule(m: ModuleInfo) {
    const body = m.ast.program.body;
    // Hoist function declarations.
    for (const st of body) {
      const decl = st.type === 'ExportNamedDeclaration' || st.type === 'ExportDefaultDeclaration' ? st.declaration : st;
      if (decl?.type === 'FunctionDeclaration' && decl.id) m.env.set(decl.id.name, this.makeFn(decl, m.env, decl.id.name));
    }
    for (const st of body) {
      try {
        this.loadStatement(m, st);
      } catch {
        /* ignore statements we cannot evaluate */
      }
    }
    for (const name of [...m.exported, ...(m.defaultName ? [m.defaultName] : [])]) {
      const v = m.env.get(name);
      if (!(v instanceof Unknown) && !this.global.has(name)) this.global.set(name, { value: v, module: m });
    }
  }

  private loadStatement(m: ModuleInfo, st: t.Statement) {
    switch (st.type) {
      case 'ImportDeclaration': {
        const src = st.source.value;
        for (const s of st.specifiers) {
          const local = s.local.name;
          const imported = s.type === 'ImportSpecifier' ? (s.imported.type === 'Identifier' ? s.imported.name : s.imported.value) : s.type === 'ImportDefaultSpecifier' ? 'default' : '*';
          const icon = iconFromImport(src, imported === 'default' ? local : imported);
          if (icon) m.env.set(local, icon);
          else if (src === 'class-variance-authority' && imported === 'cva') m.env.set(local, this.builtin('cva'));
          else if (CLASS_HELPERS.has(imported) || CLASS_HELPERS.has(local)) m.env.set(local, this.builtin('cn'));
          else if (src.startsWith('.') || src.startsWith('@/') || src.startsWith('~/')) {
            // Resolved lazily against the other imported files (by exported name).
            const name = imported === 'default' || imported === '*' ? local : imported;
            m.env.set(local, { kind: 'ext', name: `@local:${name}` });
          } else if (/^[A-Z]/.test(local)) m.env.set(local, { kind: 'ext', name: local });
        }
        return;
      }
      case 'ExportNamedDeclaration': {
        if (st.declaration) {
          this.loadStatement(m, st.declaration);
          const d = st.declaration;
          if (d.type === 'FunctionDeclaration' && d.id) m.exported.add(d.id.name);
          if (d.type === 'VariableDeclaration') for (const v of d.declarations) if (v.id.type === 'Identifier') m.exported.add(v.id.name);
        }
        for (const s of st.specifiers) if (s.type === 'ExportSpecifier') m.exported.add(s.local.name);
        return;
      }
      case 'ExportDefaultDeclaration': {
        const d = st.declaration;
        if (d.type === 'FunctionDeclaration') {
          const name = d.id?.name ?? fileBase(m.path);
          if (!d.id) m.env.set(name, this.makeFn(d, m.env, name));
          m.defaultName = name;
        } else if (d.type === 'Identifier') m.defaultName = d.name;
        else if (d.type !== 'ClassDeclaration' && d.type !== 'TSDeclareFunction') {
          const name = fileBase(m.path);
          const v = this.ev(d as t.Expression, m.env);
          if (isKind(v, 'fn')) (v as Fn).name = name;
          m.env.set(name, v);
          m.defaultName = name;
        }
        return;
      }
      case 'VariableDeclaration':
        for (const d of st.declarations) {
          const v = d.init ? this.ev(d.init, m.env) : undefined;
          if (d.id.type === 'Identifier' && isKind(v, 'fn') && !(v as Fn).name) (v as Fn).name = d.id.name;
          this.bind(d.id, v, m.env);
        }
        return;
      default:
        return;
    }
  }

  private builtin(name: string): Builtin {
    return { kind: 'builtin', name, call: (args) => this.callBuiltin(name, args) };
  }

  private makeFn(node: t.Function, env: Env, name?: string): Fn {
    return { kind: 'fn', name, params: node.params, body: node.body, env };
  }

  /* ---------------- component discovery ---------------- */

  components(): ComponentInfo[] {
    const out: ComponentInfo[] = [];
    for (const m of this.modules) {
      const names = new Set<string>();
      const consider = (name: string) => {
        if (!/^[A-Z]/.test(name) || names.has(name)) return;
        const v = m.env.get(name);
        if (!isKind(v, 'fn') || !this.returnsJsx(v as Fn)) return;
        names.add(name);
        const info: ComponentInfo = { name, file: m.path, exported: m.exported.has(name) || m.defaultName === name };
        const cva = this.cvaUsedBy(v as Fn, m);
        if (cva) {
          const key = Object.keys(cva.variants)[0];
          if (key) {
            info.variantKey = key;
            info.variantValues = Object.keys(cva.variants[key]!).slice(0, 12);
          }
        }
        out.push(info);
      };
      for (const st of m.ast.program.body) {
        const d = st.type === 'ExportNamedDeclaration' || st.type === 'ExportDefaultDeclaration' ? st.declaration : st;
        if (d?.type === 'FunctionDeclaration' && d.id) consider(d.id.name);
        if (d?.type === 'VariableDeclaration') for (const v of d.declarations) if (v.id.type === 'Identifier') consider(v.id.name);
      }
      if (m.defaultName) consider(m.defaultName);
    }
    return out.sort((a, b) => Number(b.exported) - Number(a.exported));
  }

  private returnsJsx(fn: Fn): boolean {
    let found = false;
    const walk = (n: unknown, depth: number) => {
      if (found || !n || typeof n !== 'object' || depth > 60) return;
      const node = n as { type?: string };
      if (node.type === 'JSXElement' || node.type === 'JSXFragment') {
        found = true;
        return;
      }
      for (const [k, v] of Object.entries(n)) {
        if (k === 'loc' || k === 'start' || k === 'end' || k === 'leadingComments' || k === 'trailingComments') continue;
        if (Array.isArray(v)) v.forEach((x) => walk(x, depth + 1));
        else if (v && typeof v === 'object') walk(v, depth + 1);
      }
    };
    walk(fn.body, 0);
    return found;
  }

  private cvaUsedBy(fn: Fn, m: ModuleInfo): Cva | null {
    const ids = new Set<string>();
    const walk = (n: unknown, depth: number) => {
      if (!n || typeof n !== 'object' || depth > 60) return;
      const node = n as { type?: string; name?: string };
      if (node.type === 'Identifier' && node.name) ids.add(node.name);
      for (const [k, v] of Object.entries(n)) {
        if (k === 'loc') continue;
        if (Array.isArray(v)) v.forEach((x) => walk(x, depth + 1));
        else if (v && typeof v === 'object') walk(v, depth + 1);
      }
    };
    walk(fn.body, 0);
    for (const id of ids) {
      const v = m.env.get(id);
      if (isKind(v, 'cva') && Object.keys((v as Cva).variants).length) return v as Cva;
    }
    return null;
  }

  /* ---------------- conversion ---------------- */

  /** Converts one component (and its variants) into flö node trees. */
  convert(info: ComponentInfo, parentId: string): ConvertedComponent[] {
    const m = this.modules.find((x) => x.path === info.file);
    const fn = m?.env.get(info.name);
    if (!m || !isKind(fn ?? null, 'fn')) return [];
    const variants: Record<string, string>[] = info.variantKey && info.variantValues?.length ? info.variantValues.map((v) => ({ [info.variantKey!]: v })) : [{}];
    const out: ConvertedComponent[] = [];
    for (const variant of variants) {
      this.count = 0;
      this.steps = 0;
      let rendered: CNode[] = [];
      try {
        const props: Record<string, V> = { ...variant };
        this.openProps.add(props);
        const el: El = { kind: 'el', tag: fn as Fn, props, children: [humanize(info.name)] };
        rendered = this.render(el, 0, m.tailwind);
      } catch (e) {
        this.warnings.add(`${info.name}: ${e instanceof Error ? e.message : String(e)}`);
      }
      const name = Object.keys(variant).length ? `${info.name} / ${Object.values(variant)[0]}` : info.name;
      const built = this.buildRoot(rendered, parentId, name, m.tailwind);
      out.push({ name: info.name, file: info.file, variant, tree: built.tree, width: built.w, height: built.h });
    }
    return out;
  }

  report(): { warnings: string[]; unknownClasses: string[] } {
    return { warnings: [...this.warnings], unknownClasses: [...this.unknownClasses].slice(0, 60) };
  }

  /* ---------------- evaluator ---------------- */

  private tick() {
    if (++this.steps > MAX_STEPS) throw new Error(this.msg('componente troppo complesso da analizzare', 'component too complex to analyze'));
  }

  private bind(pattern: t.Node, value: V, env: Env) {
    switch (pattern.type) {
      case 'Identifier':
        env.set(pattern.name, value);
        return;
      case 'AssignmentPattern': {
        const v = value === undefined ? this.ev(pattern.right as t.Expression, env) : value;
        this.bind(pattern.left, v, env);
        return;
      }
      case 'ObjectPattern': {
        const obj = isObj(value) ? value : {};
        const used = new Set<string>();
        for (const p of pattern.properties) {
          if (p.type === 'RestElement') {
            const rest: Record<string, V> = {};
            for (const [k, v] of Object.entries(obj)) if (!used.has(k)) rest[k] = v;
            if (this.openProps.has(obj)) this.openProps.add(rest);
            this.bind(p.argument, value instanceof Unknown ? value : rest, env);
            continue;
          }
          const key = p.key.type === 'Identifier' ? p.key.name : p.key.type === 'StringLiteral' ? p.key.value : null;
          if (!key) continue;
          used.add(key);
          const v = obj[key];
          const open = value instanceof Unknown || this.openProps.has(obj);
          this.bind(p.value, v === undefined && open && p.value.type !== 'AssignmentPattern' ? new Unknown(key) : v, env);
        }
        return;
      }
      case 'ArrayPattern': {
        const arr = Array.isArray(value) ? value : [];
        pattern.elements.forEach((el, i) => el && this.bind(el, el.type === 'RestElement' ? arr.slice(i) : arr[i], env));
        return;
      }
      case 'RestElement':
        this.bind(pattern.argument, value, env);
        return;
      case 'TSParameterProperty':
        return;
      default:
        return;
    }
  }

  private callFn(fn: Fn, args: V[]): V {
    this.tick();
    const env = new Env(fn.env);
    fn.params.forEach((p, i) => {
      if (p.type === 'RestElement') this.bind(p.argument, args.slice(i), env);
      else this.bind(p, args[i], env);
    });
    if (fn.body.type === 'BlockStatement') {
      const r = this.exec(fn.body.body, env);
      return r ? r.value : undefined;
    }
    return this.ev(fn.body as t.Expression, env);
  }

  private exec(stmts: t.Statement[], env: Env): { value: V } | null {
    for (const st of stmts) {
      this.tick();
      switch (st.type) {
        case 'VariableDeclaration':
          for (const d of st.declarations) {
            const v = d.init ? this.ev(d.init, env) : undefined;
            if (d.id.type === 'Identifier' && isKind(v, 'fn') && !(v as Fn).name) (v as Fn).name = d.id.name;
            this.bind(d.id, v, env);
          }
          break;
        case 'FunctionDeclaration':
          if (st.id) env.set(st.id.name, this.makeFn(st, env, st.id.name));
          break;
        case 'ReturnStatement':
          return { value: st.argument ? this.ev(st.argument, env) : undefined };
        case 'IfStatement': {
          const test = this.ev(st.test, env);
          if (test instanceof Unknown) break; // assume the common path (no early return)
          const branch = truthy(test) ? st.consequent : st.alternate;
          if (branch) {
            const r = this.exec(branch.type === 'BlockStatement' ? branch.body : [branch], new Env(env));
            if (r) return r;
          }
          break;
        }
        case 'BlockStatement': {
          const r = this.exec(st.body, new Env(env));
          if (r) return r;
          break;
        }
        default:
          break;
      }
    }
    return null;
  }

  private ev(node: t.Node | null | undefined, env: Env): V {
    if (!node) return undefined;
    this.tick();
    switch (node.type) {
      case 'StringLiteral':
        return node.value;
      case 'NumericLiteral':
        return node.value;
      case 'BooleanLiteral':
        return node.value;
      case 'NullLiteral':
        return null;
      case 'TemplateLiteral': {
        let s = '';
        node.quasis.forEach((q, i) => {
          s += q.value.cooked ?? q.value.raw;
          const e = node.expressions[i];
          if (e) {
            const v = this.ev(e, env);
            if (typeof v === 'string' || typeof v === 'number') s += String(v);
          }
        });
        return s;
      }
      case 'Identifier':
        if (node.name === 'undefined') return undefined;
        return env.get(node.name);
      case 'ParenthesizedExpression':
      case 'TSAsExpression':
      case 'TSSatisfiesExpression':
      case 'TSNonNullExpression':
      case 'TSTypeAssertion':
        return this.ev(node.expression, env);
      case 'ArrayExpression': {
        const out: V[] = [];
        for (const e of node.elements) {
          if (!e) continue;
          if (e.type === 'SpreadElement') {
            const v = this.ev(e.argument, env);
            if (Array.isArray(v)) out.push(...v);
          } else out.push(this.ev(e, env));
        }
        return out;
      }
      case 'ObjectExpression': {
        const out: Record<string, V> = {};
        for (const p of node.properties) {
          if (p.type === 'SpreadElement') {
            const v = this.ev(p.argument, env);
            if (isObj(v)) Object.assign(out, v);
            continue;
          }
          if (p.type === 'ObjectMethod') continue;
          const key = p.computed ? this.ev(p.key, env) : p.key.type === 'Identifier' ? p.key.name : p.key.type === 'StringLiteral' ? p.key.value : p.key.type === 'NumericLiteral' ? String(p.key.value) : undefined;
          if (typeof key !== 'string' && typeof key !== 'number') continue;
          out[String(key)] = this.ev(p.value as t.Expression, env);
        }
        return out;
      }
      case 'ArrowFunctionExpression':
      case 'FunctionExpression':
        return this.makeFn(node, env, node.type === 'FunctionExpression' ? node.id?.name : undefined);
      case 'ConditionalExpression': {
        const test = this.ev(node.test, env);
        if (test instanceof Unknown) return this.ev(node.consequent, env);
        return truthy(test) ? this.ev(node.consequent, env) : this.ev(node.alternate, env);
      }
      case 'LogicalExpression': {
        const l = this.ev(node.left, env);
        if (node.operator === '&&') return l instanceof Unknown ? this.ev(node.right, env) : truthy(l) ? this.ev(node.right, env) : l;
        if (node.operator === '||') return l instanceof Unknown ? this.ev(node.right, env) : truthy(l) ? l : this.ev(node.right, env);
        return l === null || l === undefined || l instanceof Unknown ? this.ev(node.right, env) : l;
      }
      case 'UnaryExpression': {
        const v = this.ev(node.argument, env);
        if (v instanceof Unknown) return v;
        if (node.operator === '!') return !truthy(v);
        if (node.operator === '-' && typeof v === 'number') return -v;
        if (node.operator === 'typeof') return typeof v;
        return new Unknown('expr');
      }
      case 'BinaryExpression': {
        const l = this.ev(node.left as t.Expression, env);
        const r = this.ev(node.right, env);
        if (l instanceof Unknown || r instanceof Unknown) return new Unknown(l instanceof Unknown ? l.label : (r as Unknown).label);
        switch (node.operator) {
          case '===':
          case '==':
            return l === r;
          case '!==':
          case '!=':
            return l !== r;
          case '+':
            return typeof l === 'number' && typeof r === 'number' ? l + r : String(l ?? '') + String(r ?? '');
          case '-':
          case '*':
          case '/':
          case '%':
            if (typeof l === 'number' && typeof r === 'number') return node.operator === '-' ? l - r : node.operator === '*' ? l * r : node.operator === '/' ? l / r : l % r;
            return new Unknown('expr');
          case '<':
          case '>':
          case '<=':
          case '>=':
            if (typeof l === 'number' && typeof r === 'number') return node.operator === '<' ? l < r : node.operator === '>' ? l > r : node.operator === '<=' ? l <= r : l >= r;
            return new Unknown('expr');
          default:
            return new Unknown('expr');
        }
      }
      case 'MemberExpression':
      case 'OptionalMemberExpression': {
        const obj = this.ev(node.object, env);
        const key = node.computed ? this.ev(node.property as t.Expression, env) : node.property.type === 'Identifier' ? node.property.name : undefined;
        return this.member(obj, key, node.object);
      }
      case 'CallExpression':
      case 'OptionalCallExpression':
        return this.call(node, env);
      case 'JSXElement':
        return this.jsx(node, env);
      case 'JSXFragment':
        return { kind: 'el', tag: '#fragment', props: {}, children: this.jsxChildren(node.children, env) };
      case 'SequenceExpression':
        return this.ev(node.expressions[node.expressions.length - 1], env);
      default:
        return new Unknown('expr');
    }
  }

  private member(obj: V, key: V, objNode?: t.Node): V {
    if (obj instanceof Unknown) return new Unknown(typeof key === 'string' ? key : obj.label);
    if (typeof key !== 'string' && typeof key !== 'number') return new Unknown('expr');
    if (Array.isArray(obj)) return key === 'length' ? obj.length : obj[Number(key)];
    if (typeof obj === 'string') return key === 'length' ? obj.length : obj[Number(key)];
    if (isObj(obj)) return Object.prototype.hasOwnProperty.call(obj, key) ? obj[key] : this.openProps.has(obj) ? new Unknown(String(key)) : undefined;
    if (isKind(obj, 'ext')) return { kind: 'ext', name: `${(obj as ExtRef).name}.${key}` };
    if (isKind(obj, 'icon')) return obj;
    if (objNode?.type === 'Identifier' && objNode.name === 'React') return this.builtin(String(key));
    return new Unknown(String(key));
  }

  private call(node: t.CallExpression | t.OptionalCallExpression, env: Env): V {
    const args = () => node.arguments.map((a) => (a.type === 'SpreadElement' ? this.ev(a.argument, env) : this.ev(a as t.Expression, env)));
    const callee = node.callee;
    // Method calls on values.
    if ((callee.type === 'MemberExpression' || callee.type === 'OptionalMemberExpression') && !callee.computed && callee.property.type === 'Identifier') {
      const method = callee.property.name;
      if (callee.object.type === 'Identifier' && callee.object.name === 'React') return this.callBuiltin(method, args());
      if (callee.object.type === 'Identifier' && callee.object.name === 'Object' && !env.has('Object')) {
        const [o] = args();
        if (!isObj(o)) return [];
        if (method === 'keys') return Object.keys(o);
        if (method === 'values') return Object.values(o);
        if (method === 'entries') return Object.entries(o).map(([k, v]) => [k, v]);
        return new Unknown(method);
      }
      const obj = this.ev(callee.object, env);
      return this.callMethod(obj, method, args());
    }
    const fnv = this.ev(callee as t.Expression, env);
    if (fnv instanceof Unknown) {
      if (callee.type === 'Identifier' && !env.has(callee.name)) return this.callBuiltin(callee.name, args());
      return new Unknown(fnv.label);
    }
    if (isKind(fnv, 'builtin')) return (fnv as Builtin).call(args());
    if (isKind(fnv, 'fn')) return this.callFn(fnv as Fn, args());
    if (isKind(fnv, 'cva')) return this.applyCva(fnv as Cva, args()[0]);
    return new Unknown('call');
  }

  private callMethod(obj: V, method: string, args: V[]): V {
    if (obj instanceof Unknown) {
      // Rendering a list whose data is unknown: render one representative item.
      if ((method === 'map' || method === 'flatMap') && isKind(args[0] ?? null, 'fn')) return [this.callFn(args[0] as Fn, [new Unknown(singular(obj.label)), 0])];
      return new Unknown(obj.label);
    }
    if (Array.isArray(obj)) {
      const f = args[0];
      const cb = (x: V, i: number) => (isKind(f ?? null, 'fn') ? this.callFn(f as Fn, [x, i, obj]) : isKind(f ?? null, 'builtin') ? (f as Builtin).call([x]) : x);
      switch (method) {
        case 'map':
          return obj.slice(0, 50).map(cb);
        case 'flatMap':
          return obj.slice(0, 50).flatMap((x, i) => {
            const r = cb(x, i);
            return Array.isArray(r) ? r : [r];
          });
        case 'filter':
          return obj.filter((x, i) => {
            const r = cb(x, i);
            return r instanceof Unknown ? true : truthy(r);
          });
        case 'find':
          return obj.find((x, i) => {
            const r = cb(x, i);
            return r instanceof Unknown ? true : truthy(r);
          });
        case 'slice':
          return obj.slice(typeof args[0] === 'number' ? args[0] : 0, typeof args[1] === 'number' ? args[1] : undefined);
        case 'join':
          return obj.filter((x) => typeof x === 'string' || typeof x === 'number').join(typeof args[0] === 'string' ? args[0] : ',');
        case 'concat':
          return obj.concat(...args.map((a) => (Array.isArray(a) ? a : [a])));
        case 'includes':
          return obj.includes(args[0]);
        case 'reverse':
          return [...obj].reverse();
        case 'at':
          return obj.at(typeof args[0] === 'number' ? args[0] : 0);
        default:
          return new Unknown(method);
      }
    }
    if (typeof obj === 'string') {
      switch (method) {
        case 'toUpperCase':
          return obj.toUpperCase();
        case 'toLowerCase':
          return obj.toLowerCase();
        case 'trim':
          return obj.trim();
        case 'split':
          return typeof args[0] === 'string' ? obj.split(args[0]) : [obj];
        case 'slice':
          return obj.slice(typeof args[0] === 'number' ? args[0] : 0, typeof args[1] === 'number' ? args[1] : undefined);
        case 'charAt':
          return obj.charAt(typeof args[0] === 'number' ? args[0] : 0);
        case 'includes':
          return typeof args[0] === 'string' ? obj.includes(args[0]) : false;
        case 'replace':
          return typeof args[0] === 'string' && typeof args[1] === 'string' ? obj.replace(args[0], args[1]) : obj;
        default:
          return new Unknown(method);
      }
    }
    if (typeof obj === 'number' && method === 'toFixed') return obj.toFixed(typeof args[0] === 'number' ? Math.min(10, Math.max(0, args[0])) : 0);
    if (typeof obj === 'number' && method === 'toString') return String(obj);
    if (typeof obj === 'number' && method === 'toLocaleString') return obj.toLocaleString(this.lang === 'it' ? 'it-IT' : 'en-US');
    return new Unknown(method);
  }

  private callBuiltin(name: string, args: V[]): V {
    if (CLASS_HELPERS.has(name)) return classJoin(args);
    switch (name) {
      case 'cva': {
        const cfg = isObj(args[1] ?? null) ? (args[1] as Record<string, V>) : {};
        const variants: Record<string, Record<string, string>> = {};
        if (isObj(cfg.variants ?? null))
          for (const [k, vals] of Object.entries(cfg.variants as Record<string, V>)) {
            if (!isObj(vals)) continue;
            variants[k] = Object.fromEntries(Object.entries(vals).map(([vk, cls]) => [vk, classJoin([cls])]));
          }
        const defaults: Record<string, string> = {};
        if (isObj(cfg.defaultVariants ?? null)) for (const [k, v] of Object.entries(cfg.defaultVariants as Record<string, V>)) if (typeof v === 'string' || typeof v === 'boolean') defaults[k] = String(v);
        return { kind: 'cva', base: classJoin([args[0]]), variants, defaults };
      }
      case 'forwardRef':
      case 'memo':
        return args[0];
      case 'useState':
      case 'useReducer': {
        const init = name === 'useState' ? args[0] : args[1];
        return [isKind(init ?? null, 'fn') ? this.callFn(init as Fn, []) : init, this.builtin('noop')];
      }
      case 'useRef':
        return { current: args[0] ?? null };
      case 'useMemo':
        return isKind(args[0] ?? null, 'fn') ? this.callFn(args[0] as Fn, []) : undefined;
      case 'useCallback':
        return args[0];
      case 'useId':
        return 'id';
      case 'String':
        return args[0] === undefined ? '' : args[0] instanceof Unknown ? args[0] : String(args[0]);
      case 'Boolean':
        return args[0] instanceof Unknown ? args[0] : truthy(args[0]);
      case 'noop':
        return undefined;
      default:
        return new Unknown(name);
    }
  }

  private applyCva(c: Cva, arg: V): string {
    const props = isObj(arg ?? null) ? (arg as Record<string, V>) : {};
    const parts = [c.base];
    for (const [k, vals] of Object.entries(c.variants)) {
      let v = props[k];
      if (v === undefined || v === null || v instanceof Unknown) v = c.defaults[k];
      if (v !== undefined && vals[String(v)]) parts.push(vals[String(v)]!);
    }
    if (typeof props.className === 'string') parts.push(props.className);
    return parts.join(' ');
  }

  private jsx(node: t.JSXElement, env: Env): El {
    const nameNode = node.openingElement.name;
    let tag: El['tag'];
    if (nameNode.type === 'JSXIdentifier') {
      if (/^[a-z]/.test(nameNode.name)) tag = nameNode.name;
      else {
        const v = env.get(nameNode.name);
        tag = this.resolveTag(v, nameNode.name);
      }
    } else if (nameNode.type === 'JSXMemberExpression') {
      const full = jsxMemberName(nameNode);
      tag = full === 'React.Fragment' || full === 'Fragment' ? '#fragment' : { kind: 'ext', name: full };
    } else tag = '#fragment';
    if (nameNode.type === 'JSXIdentifier' && nameNode.name === 'Fragment') tag = '#fragment';
    const props: Record<string, V> = {};
    for (const a of node.openingElement.attributes) {
      if (a.type === 'JSXSpreadAttribute') {
        const v = this.ev(a.argument, env);
        if (isObj(v)) Object.assign(props, v);
        continue;
      }
      const key = a.name.type === 'JSXIdentifier' ? a.name.name : `${a.name.namespace.name}:${a.name.name.name}`;
      if (a.value === null || a.value === undefined) props[key] = true;
      else if (a.value.type === 'StringLiteral') props[key] = a.value.value;
      else if (a.value.type === 'JSXExpressionContainer') props[key] = a.value.expression.type === 'JSXEmptyExpression' ? undefined : this.ev(a.value.expression, env);
      else props[key] = this.ev(a.value, env);
    }
    const children = this.jsxChildren(node.children, env);
    return { kind: 'el', tag, props, children };
  }

  private resolveTag(v: V, name: string): El['tag'] {
    if (typeof v === 'string') return v;
    if (isKind(v, 'fn')) return v as Fn;
    if (isKind(v, 'icon')) return v as IconRef;
    if (isKind(v, 'ext')) {
      const ext = v as ExtRef;
      if (ext.name.startsWith('@local:')) {
        const g = this.global.get(ext.name.slice(7));
        if (g && isKind(g.value, 'fn')) return g.value as Fn;
        return { kind: 'ext', name };
      }
      return ext;
    }
    if (v instanceof Unknown) {
      const g = this.global.get(name);
      if (g && isKind(g.value, 'fn')) return g.value as Fn;
    }
    return { kind: 'ext', name };
  }

  private jsxChildren(children: t.Node[], env: Env): V[] {
    const out: V[] = [];
    for (const c of children) {
      if (c.type === 'JSXText') {
        const text = jsxText(c.value);
        if (text) out.push(text);
      } else if (c.type === 'JSXExpressionContainer') {
        if (c.expression.type !== 'JSXEmptyExpression') out.push(this.ev(c.expression, env));
      } else if (c.type === 'JSXSpreadChild') out.push(this.ev(c.expression, env));
      else out.push(this.ev(c, env));
    }
    return out;
  }

  /* ---------------- render: values → CNodes ---------------- */

  private stack: string[] = [];
  /** Props objects of components rendered standalone: missing props are unknown, not undefined. */
  private openProps = new WeakSet<object>();

  private render(v: V, depth: number, tailwind: boolean): CNode[] {
    if (depth > MAX_DEPTH) return [];
    if (v === null || v === undefined || typeof v === 'boolean') return [];
    if (typeof v === 'string' || typeof v === 'number') return [{ t: 'text', text: String(v) }];
    if (v instanceof Unknown) return [{ t: 'text', text: humanize(v.label), placeholder: true }];
    if (Array.isArray(v)) return v.flatMap((x) => this.render(x, depth + 1, tailwind));
    if (!isKind(v, 'el')) return [];
    const el = v as El;
    const children = el.children.length ? el.children : el.props.children !== undefined ? [el.props.children] : [];
    const tag = el.tag;
    if (tag === '#fragment') return children.flatMap((c) => this.render(c, depth + 1, tailwind));
    if (typeof tag === 'string') {
      if (SKIP_TAGS.has(tag)) return [];
      if (el.props.dangerouslySetInnerHTML !== undefined) this.warnings.add(this.msg('Contenuto HTML grezzo (dangerouslySetInnerHTML) ignorato per sicurezza.', 'Raw HTML (dangerouslySetInnerHTML) ignored for safety.'));
      return [
        {
          t: 'el',
          tag,
          className: classJoin([el.props.className ?? el.props.class]),
          style: isObj(el.props.style ?? null) ? (el.props.style as Record<string, V>) : null,
          attrs: el.props,
          children: tag === 'svg' ? [] : children.flatMap((c) => this.render(c, depth + 1, tailwind)),
          tailwind,
        },
      ];
    }
    if (isKind(tag, 'icon')) {
      const ic = tag as IconRef;
      if (!ic.icon) this.warnings.add(this.msg(`Icona ${ic.name} non presente nella libreria flö: sostituita con "star".`, `Icon ${ic.name} is not in the flö library: replaced with "star".`));
      return [{ t: 'icon', icon: ic.icon ?? 'star', name: ic.name, className: classJoin([el.props.className]), attrs: el.props }];
    }
    if (isKind(tag, 'ext')) {
      const ext = tag as ExtRef;
      const rendered = children.flatMap((c) => this.render(c, depth + 1, tailwind));
      const transparent = /(Provider|Root|Portal|Trigger|Slot|Fragment|Suspense|Link|Router|Route|Head|Tooltip|Popover|Dialog|Sheet|Collapsible|Context|Motion|motion\.)/.test(ext.name);
      if (ext.name.startsWith('motion.')) {
        // framer-motion elements behave like their HTML counterpart.
        return this.render({ ...el, tag: ext.name.slice(7) }, depth, tailwind);
      }
      if (ext.name === 'Image' || ext.name === 'NextImage') return this.render({ ...el, tag: 'img' }, depth, tailwind);
      if (ext.name === 'Link' || ext.name.endsWith('.Link')) return this.render({ ...el, tag: 'a' }, depth, tailwind);
      if (!transparent) this.warnings.add(this.msg(`Componente esterno <${ext.name}> non incluso: convertito come contenitore segnaposto.`, `External component <${ext.name}> not included: converted as a placeholder container.`));
      if (transparent && !classJoin([el.props.className])) return rendered;
      return [{ t: 'el', tag: 'div', className: classJoin([el.props.className]), style: null, attrs: el.props, children: rendered, tailwind, ext: ext.name }];
    }
    // Local component.
    const fn = tag as Fn;
    const name = fn.name ?? 'Component';
    if (this.stack.filter((s) => s === name).length > 2 || this.stack.length > 20) return [];
    this.stack.push(name);
    try {
      const props = { ...el.props, children: el.children.length ? (el.children.length === 1 ? el.children[0] : el.children) : el.props.children };
      if (this.openProps.has(el.props)) this.openProps.add(props);
      const out = this.callFn(fn, [props, null]);
      return this.render(out, depth + 1, tailwind);
    } finally {
      this.stack.pop();
    }
  }

  /* ---------------- build: CNodes → flö layers ---------------- */

  private buildRoot(nodes: CNode[], parentId: string, name: string, tailwind: boolean): { tree: NodeTree; w: number; h: number } {
    const baseInh: Inh = { d: {}, m: {} };
    let built: Built | null = null;
    const single = nodes.length === 1 && nodes[0]!.t === 'el' ? (nodes[0] as ElNode) : null;
    if (single && !this.isText(single)) {
      built = this.buildEl(single, parentId, null, baseInh);
    }
    if (!built) {
      // Wrap loose content in a frame so the component root is always a frame.
      const wrapper: ElNode = { t: 'el', tag: 'div', className: tailwind ? 'flex flex-col gap-2' : '', style: null, attrs: {}, children: nodes, tailwind };
      built = this.buildEl(wrapper, parentId, null, baseInh);
    }
    if (!built) {
      const empty = createFrame({ parentId, name, width: 320, height: 120 }, { fills: [], layout: { ...NO_PAD } });
      built = { nodes: [empty], w: 320, h: 120 };
    }
    const root = built.nodes[0] as FrameNode;
    root.name = name;
    root.layoutPositioning = 'absolute';
    return { tree: { root, nodes: built.nodes }, w: built.w, h: built.h };
  }

  /** True when an element should become a single text layer. */
  private isText(c: ElNode): boolean {
    if (!TEXT_TAGS.has(c.tag) && !BLOCK_TEXT_TAGS.has(c.tag)) return false;
    const unknown = new Set<string>();
    const { desktop, mobile } = parseClasses(c.className, unknown);
    if (c.style) applyInlineStyle(desktop, c.style as Record<string, unknown>, unknown);
    if (hasBox(desktop) || hasBox(mobile)) return false;
    if (!c.children.length) return false;
    return c.children.every((ch) => ch.t === 'text' || (ch.t === 'el' && INLINE_TEXT.has(ch.tag) && this.isTextInline(ch)));
  }

  private isTextInline(c: ElNode): boolean {
    if (c.tag === 'br') return true;
    const unknown = new Set<string>();
    const { desktop } = parseClasses(c.className, unknown);
    if (hasBox(desktop)) return false;
    return c.children.every((ch) => ch.t === 'text' || (ch.t === 'el' && INLINE_TEXT.has(ch.tag) && this.isTextInline(ch)));
  }

  private specs(c: ElNode): { d: StyleSpec; m: StyleSpec } {
    const { mobile, desktop } = parseClasses(c.className, this.unknownClasses);
    const defaults = tagDefaults(c.tag, c.tailwind);
    const d = { ...defaults, ...stripUndef(desktop) };
    const m = { ...defaults, ...stripUndef(mobile) };
    if (c.style) {
      applyInlineStyle(d, c.style as Record<string, unknown>, this.unknownClasses);
      applyInlineStyle(m, c.style as Record<string, unknown>, new Set());
    }
    return { d, m };
  }

  private buildEl(c: ElNode, parentId: string, parent: ParentInfo | null, inh: Inh): Built | null {
    if (++this.count > this.maxNodes) {
      this.warnings.add(this.msg(`Limite di ${this.maxNodes} livelli raggiunto: parte del contenuto è stata omessa.`, `Limit of ${this.maxNodes} layers reached: some content was omitted.`));
      return null;
    }
    const { d, m } = this.specs(c);
    if (d.hidden && m.hidden) return null; // never visible (e.g. sr-only helpers are ignored, hidden always)
    const effD = { ...inh.d, ...pick(d, INHERITED) };
    const effM = { ...inh.m, ...pick(m, INHERITED) };
    const nextInh: Inh = { d: effD, m: effM };

    if (c.tag === 'br') return null;
    if (c.tag === 'hr') {
      const line = createLine({ parentId, width: 200, height: 0, name: 'Divider' }, { layoutPositioning: 'auto', sizing: { horizontal: 'fill', vertical: 'fixed' }, stroke: { color: d.borderColor ?? '#E5E5E5', opacity: 1, width: 1, visible: true } });
      return { nodes: [line], w: 200, h: 1 };
    }
    if (c.tag === 'img') return this.buildImage(c, parentId, parent, d);
    if (c.tag === 'svg') {
      this.warnings.add(this.msg('Gli SVG inline sono importati come segnaposto.', 'Inline SVGs are imported as placeholders.'));
      const w = num(d.width) ?? num(c.attrs.width) ?? 24;
      const h = num(d.height) ?? num(c.attrs.height) ?? 24;
      const rect = createRect({ parentId, width: w, height: h, name: 'SVG' }, { layoutPositioning: 'auto', fills: [solid(effD.color ?? '#0A0A0A', 0.15)], radius: [4, 4, 4, 4] });
      return { nodes: [rect], w, h };
    }
    if (c.tag === 'input' || c.tag === 'textarea' || c.tag === 'select') return this.buildInput(c, parentId, parent, d, m, effD);
    if (this.isText(c)) return this.buildText(textOf(c), c.tag, parentId, parent, d, m, effD, effM, c.attrs);

    // Frame.
    const isButton = c.tag === 'button' || (c.tag === 'a' && hasBox(d));
    const inline = d.inline ?? (INLINE_TAGS.has(c.tag) || isButton);
    const grid = d.display === 'grid' && (d.gridCols ?? 1) > 1;
    const layoutOf = (s: StyleSpec): FrameNode['layout'] => {
      const flex = s.display === 'flex';
      const horizontal = (flex && s.direction !== 'column') || (!flex && s.display !== 'grid' && isButton);
      return {
        mode: horizontal ? 'horizontal' : 'vertical',
        gap: s.gap ?? 0,
        padding: [s.pt ?? 0, s.pr ?? 0, s.pb ?? 0, s.pl ?? 0],
        primaryAlign: s.justify ?? (isButton && !flex ? 'center' : 'start'),
        counterAlign: s.align === 'center' || (isButton && !flex && !s.align) ? 'center' : s.align === 'end' ? 'end' : 'start',
        wrap: !!s.wrap && horizontal,
      };
    };
    const layout = layoutOf(d);
    const layoutM = layoutOf(m);
    const layoutD0 = JSON.stringify(layout);
    const childParent = (s: StyleSpec, l: FrameNode['layout']): ParentInfo => ({
      mode: l.mode === 'horizontal' ? 'horizontal' : 'vertical',
      stretch: s.display === 'flex' ? !s.align || s.align === 'stretch' : s.display === 'grid' ? true : true,
      block: s.display !== 'flex' && s.display !== 'grid',
    });

    const frame = createFrame(
      { parentId, name: c.ext ? `<${c.ext}>` : nameFor(c) },
      {
        role: FRAME_ROLE[c.tag] ?? 'div',
        fills: paints(d),
        clipContent: /\boverflow-(hidden|clip)\b/.test(c.className),
        layout,
        stroke: d.borderWidth ? { color: d.borderColor ?? '#E5E5E5', opacity: 1, width: d.borderWidth, visible: true } : c.ext && !c.children.length ? { color: '#A1A1AA', opacity: 1, width: 1, visible: true } : null,
        radius: radius4(d.radius),
        effects: shadow(d.shadow),
        opacity: d.opacity ?? 1,
        visible: !d.hidden,
        layoutPositioning: parent ? (d.absolute ? 'absolute' : 'auto') : 'absolute',
        minWidth: d.minWidth ?? null,
        maxWidth: d.maxWidth ?? null,
        minHeight: d.minHeight ?? null,
        maxHeight: d.maxHeight ?? null,
      },
    );
    const nodes: DesignNode[] = [frame];
    const cp = childParent(d, layout);
    const childInfos: { w: number; h: number; margin: [number, number, number, number] }[] = [];

    let kids = c.children;
    if (c.ext && !kids.length) kids = [{ t: 'text', text: c.ext }];

    if (grid) {
      const cols = d.gridCols!;
      const mobileCols = m.display === 'grid' ? (m.gridCols ?? 1) : 1;
      frame.layout = { ...layout, mode: 'vertical', counterAlign: 'start' };
      for (let i = 0; i < kids.length; i += cols) {
        const row = createFrame(
          { parentId: frame.id, name: `Row ${i / cols + 1}` },
          { layoutPositioning: 'auto', fills: [], clipContent: false, sizing: { horizontal: 'fill', vertical: 'hug' }, layout: { ...NO_PAD, mode: 'horizontal', gap: d.gap ?? 0, counterAlign: 'start' } },
        );
        if (mobileCols !== cols) {
          if (mobileCols > 1) this.warnings.add(this.msg('Griglie con colonne diverse su mobile: le righe diventano verticali sotto i 640 px.', 'Grids with a different column count on mobile: rows become vertical below 640 px.'));
          row.responsive['bp-mobile'] = { layout: { ...row.layout, mode: 'vertical', gap: m.gap ?? row.layout.gap } };
        }
        frame.childIds.push(row.id);
        nodes.push(row);
        let rw = 0;
        let rh = 0;
        for (const kid of kids.slice(i, i + cols)) {
          const b = this.buildChild(kid, row.id, { mode: 'horizontal', stretch: true, block: false, gridCell: true }, nextInh);
          if (!b) continue;
          row.childIds.push(b.nodes[0]!.id);
          nodes.push(...b.nodes);
          rw += b.w + (row.layout.gap || 0);
          rh = Math.max(rh, b.h);
        }
        row.width = rw;
        row.height = rh;
        childInfos.push({ w: rw, h: rh, margin: [0, 0, 0, 0] });
      }
    } else {
      // Children that are all `mx-auto` blocks are centered by the parent.
      if (cp.block && kids.length && kids.every((k) => k.t === 'el' && /\bmx-auto\b/.test(k.className))) frame.layout.counterAlign = 'center';
      for (const kid of kids) {
        const b = this.buildChild(kid, frame.id, cp, nextInh);
        if (!b) continue;
        frame.childIds.push(b.nodes[0]!.id);
        nodes.push(...b.nodes);
        childInfos.push({ w: b.w, h: b.h, margin: this.margins(kid) });
      }
      // Tailwind margins between siblings (mt-4, mb-2 …) become the stack gap.
      if (d.gap === undefined && childInfos.length > 1) {
        const gaps: number[] = [];
        for (let i = 1; i < childInfos.length; i++) {
          const a = childInfos[i - 1]!.margin;
          const b = childInfos[i]!.margin;
          const g = frame.layout.mode === 'horizontal' ? a[1] + b[3] : a[2] + b[0];
          if (g > 0) gaps.push(g);
        }
        if (gaps.length) {
          const freq = new Map<number, number>();
          gaps.forEach((g) => freq.set(g, (freq.get(g) ?? 0) + 1));
          const best = [...freq.entries()].sort((x, y) => y[1] - x[1] || x[0] - y[0])[0]![0];
          frame.layout = { ...frame.layout, gap: best };
          if (m.gap === undefined) layoutM.gap = best;
        }
      }
    }

    // Sizing.
    const sizingOf = (s: StyleSpec): FrameNode['sizing'] => ({ horizontal: hSizing(s, parent, inline), vertical: vSizing(s, parent, true) });
    frame.sizing = sizingOf(d);
    // Size estimates (the canvas lays out hug/fill sizes itself).
    const horizontal = frame.layout.mode === 'horizontal';
    const visibleKids = childInfos;
    const gapTotal = Math.max(0, visibleKids.length - 1) * frame.layout.gap;
    const contentW = horizontal ? visibleKids.reduce((a, k) => a + k.w, 0) + gapTotal : Math.max(0, ...visibleKids.map((k) => k.w));
    const contentH = horizontal ? Math.max(0, ...visibleKids.map((k) => k.h)) : visibleKids.reduce((a, k) => a + k.h, 0) + gapTotal;
    const [pt, pr, pb, pl] = frame.layout.padding;
    let w = num(d.width) ?? contentW + pl + pr;
    let h = num(d.height) ?? contentH + pt + pb;
    if (!parent) {
      // Component roots: fixed width for blocks, hug for inline elements.
      if (frame.sizing.horizontal !== 'hug' && num(d.width) === undefined) {
        const semantic = SECTION_TAGS.has(c.tag) || grid || d.width === 'fill';
        w = d.maxWidth ?? (semantic ? 1200 : Math.max(320, Math.min(480, w)));
        frame.sizing = { ...frame.sizing, horizontal: 'fixed' };
      }
      if (frame.sizing.vertical === 'fill') frame.sizing = { ...frame.sizing, vertical: 'hug' };
    }
    if (d.minHeight) h = Math.max(h, d.minHeight);
    if (d.maxWidth) w = Math.min(w, d.maxWidth);
    frame.width = Math.max(1, Math.round(w));
    frame.height = Math.max(1, Math.round(h));
    if (frame.layout.mode !== 'none' && !kids.length && frame.sizing.horizontal === 'hug' && num(d.width) === undefined) {
      // Empty decorative box without explicit size.
      frame.sizing = { horizontal: parent?.mode === 'vertical' && parent.stretch ? 'fill' : 'fixed', vertical: 'fixed' };
      frame.width = Math.max(frame.width, 24);
      frame.height = Math.max(frame.height, num(d.height) ?? 24);
    }

    // Mobile overrides.
    const ov: NonNullable<DesignNode['responsive'][string]> = {};
    if (!!m.hidden !== !!d.hidden) ov.visible = !m.hidden;
    if (!grid && !m.hidden && JSON.stringify(layoutM) !== JSON.stringify({ ...JSON.parse(layoutD0), gap: frame.layout.gap })) ov.layout = { ...layoutM, counterAlign: frame.layout.counterAlign === 'center' && cp.block ? 'center' : layoutM.counterAlign };
    if (parent || num(m.width) !== undefined) {
      const sm = sizingOf(m);
      if (sm.horizontal !== frame.sizing.horizontal || sm.vertical !== frame.sizing.vertical) if (parent) ov.sizing = sm;
    }
    if (num(m.width) !== undefined && num(m.width) !== num(d.width)) ov.width = num(m.width)!;
    if (num(m.height) !== undefined && num(m.height) !== num(d.height)) ov.height = num(m.height)!;
    if (m.maxWidth !== d.maxWidth) ov.maxWidth = m.maxWidth ?? null;
    if (m.radius !== d.radius) ov.radius = radius4(m.radius);
    if ((m.opacity ?? 1) !== (d.opacity ?? 1)) ov.opacity = m.opacity ?? 1;
    if (Object.keys(ov).length) frame.responsive['bp-mobile'] = { ...(frame.responsive['bp-mobile'] ?? {}), ...ov };
    return { nodes, w: frame.width, h: frame.height };
  }

  private margins(kid: CNode): [number, number, number, number] {
    if (kid.t === 'text') return [0, 0, 0, 0];
    const { desktop: d } = parseClasses(kid.className, new Set());
    return [d.mt ?? 0, d.mr ?? 0, d.mb ?? 0, d.ml ?? 0];
  }

  private buildChild(kid: CNode, parentId: string, parent: ParentInfo, inh: Inh): Built | null {
    if (kid.t === 'text') {
      const text = kid.text.trim();
      if (!text) return null;
      if (++this.count > this.maxNodes) return null;
      return this.buildText(text, 'span', parentId, parent, {}, {}, inh.d, inh.m, {});
    }
    if (kid.t === 'icon') return this.buildIcon(kid, parentId, inh);
    return this.buildEl(kid, parentId, parent, inh);
  }

  private buildText(characters: string, tag: string, parentId: string, parent: ParentInfo | null, d: StyleSpec, m: StyleSpec, effD: StyleSpec, effM: StyleSpec, attrs: Record<string, V>): Built {
    const props = textProps(effD);
    const block = !INLINE_TAGS.has(tag) || d.display === 'block' || d.display === 'flex';
    const rawW = characters.length * props.fontSize * 0.55;
    // In a vertical stack, centered/right-aligned or long text takes the full width so it can wrap.
    const wraps = props.textAlign !== 'left' || characters.length > 48;
    const horizontal: 'fixed' | 'hug' | 'fill' =
      num(d.width) !== undefined
        ? 'fixed'
        : d.width === 'fill' && parent
          ? 'fill'
          : parent?.gridCell
            ? 'fill'
            : parent?.mode === 'vertical' && ((parent.stretch && (block || !parent.block)) || wraps)
              ? 'fill'
              : parent?.mode === 'horizontal' && d.grow
                ? 'fill'
                : 'hug';
    const lh = props.lineHeight.unit === 'px' ? props.lineHeight.value : props.lineHeight.unit === 'percent' ? (props.fontSize * props.lineHeight.value) / 100 : props.fontSize * 1.2;
    const w = num(d.width) ?? Math.max(8, Math.round(Math.min(rawW, horizontal === 'hug' ? 2000 : 640)));
    const lines = horizontal === 'hug' ? 1 : Math.max(1, Math.ceil(rawW / Math.max(w, 1)));
    const text = createText(
      { parentId, name: characters.slice(0, 40) || 'Text' },
      {
        ...props,
        characters: characters.slice(0, 10_000),
        role: TEXT_ROLE[tag] ?? (block ? 'p' : 'span'),
        layoutPositioning: parent ? (d.absolute ? 'absolute' : 'auto') : 'absolute',
        sizing: { horizontal, vertical: num(d.height) !== undefined ? 'fixed' : 'hug' },
        width: w,
        height: num(d.height) ?? Math.round(lh * lines),
        visible: !d.hidden,
        opacity: d.opacity ?? 1,
        maxWidth: d.maxWidth ?? null,
      },
    );
    if (typeof attrs.href === 'string' && tag === 'a') text.role = 'a';
    const mp = textProps(effM);
    const ov: NonNullable<DesignNode['responsive'][string]> = {};
    if (mp.fontSize !== props.fontSize) ov.fontSize = mp.fontSize;
    if (JSON.stringify(mp.lineHeight) !== JSON.stringify(props.lineHeight)) ov.lineHeight = mp.lineHeight;
    if (mp.letterSpacing !== props.letterSpacing) ov.letterSpacing = mp.letterSpacing;
    if (mp.textAlign !== props.textAlign) ov.textAlign = mp.textAlign;
    if (!!m.hidden !== !!d.hidden) ov.visible = !m.hidden;
    if (Object.keys(ov).length) text.responsive['bp-mobile'] = ov;
    return { nodes: [text], w: text.width, h: text.height };
  }

  private buildIcon(c: IconNodeC, parentId: string, inh: Inh): Built {
    const { d } = this.specs({ t: 'el', tag: 'span', className: c.className, style: null, attrs: {}, children: [], tailwind: true });
    const size = num(d.width) ?? num(d.height) ?? num(c.attrs.size) ?? 24;
    const color = typeof c.attrs.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(c.attrs.color) ? c.attrs.color.toUpperCase() : (d.color ?? inh.d.color ?? '#0A0A0A');
    const icon = createIcon({ parentId, width: size, height: num(d.height) ?? size, name: c.name }, c.icon, {
      layoutPositioning: 'auto',
      fills: [solid(color, d.colorOpacity ?? inh.d.colorOpacity ?? 1)],
      strokeWidth: typeof c.attrs.strokeWidth === 'number' ? Math.min(4, Math.max(0.5, c.attrs.strokeWidth)) : 2,
      visible: !d.hidden,
    });
    return { nodes: [icon], w: icon.width, h: icon.height };
  }

  private buildImage(c: ElNode, parentId: string, parent: ParentInfo | null, d: StyleSpec): Built {
    this.warnings.add(this.msg('Le immagini sono importate come segnaposto: sostituiscile dal pannello Risorse.', 'Images are imported as placeholders: replace them from the Assets panel.'));
    const w = num(d.width) ?? num(c.attrs.width) ?? 240;
    const h = num(d.height) ?? num(c.attrs.height) ?? (parent?.mode === 'vertical' ? 200 : 160);
    const fill = num(d.width) === undefined && num(c.attrs.width) === undefined && (d.width === 'fill' || (parent?.mode === 'vertical' && parent.stretch) || !!parent?.gridCell);
    const img = createImage(
      { parentId, width: w, height: h, name: typeof c.attrs.alt === 'string' && c.attrs.alt ? c.attrs.alt.slice(0, 40) : 'Image' },
      {
        layoutPositioning: parent ? 'auto' : 'absolute',
        alt: typeof c.attrs.alt === 'string' ? c.attrs.alt.slice(0, 1000) : '',
        radius: radius4(d.radius),
        sizing: { horizontal: fill && parent ? 'fill' : 'fixed', vertical: 'fixed' },
        fit: /\bobject-contain\b/.test(c.className) ? 'contain' : 'cover',
        visible: !d.hidden,
      },
    );
    return { nodes: [img], w, h };
  }

  private buildInput(c: ElNode, parentId: string, parent: ParentInfo | null, d: StyleSpec, m: StyleSpec, eff: StyleSpec): Built | null {
    const type = typeof c.attrs.type === 'string' ? c.attrs.type : 'text';
    if (type === 'checkbox' || type === 'radio') {
      const s = num(d.width) ?? 16;
      const box = createFrame(
        { parentId, width: s, height: s, name: type === 'radio' ? 'Radio' : 'Checkbox' },
        { layoutPositioning: 'auto', role: 'input', fills: [solid(d.bg ?? '#FFFFFF')], stroke: { color: d.borderColor ?? '#A3A3A3', opacity: 1, width: 1, visible: true }, radius: radius4(type === 'radio' ? 999 : (d.radius ?? 4)), layout: { ...NO_PAD, mode: 'none' } },
      );
      return { nodes: [box], w: s, h: s };
    }
    if (type === 'hidden') return null;
    const placeholder =
      typeof c.attrs.value === 'string' && c.attrs.value ? c.attrs.value : typeof c.attrs.defaultValue === 'string' && c.attrs.defaultValue ? c.attrs.defaultValue : typeof c.attrs.placeholder === 'string' ? c.attrs.placeholder : c.tag === 'select' ? (c.children.map(textOfNode).find(Boolean) ?? 'Select') : '';
    const muted = !(typeof c.attrs.value === 'string' && c.attrs.value);
    const hasPad = d.pt !== undefined || d.pl !== undefined;
    const w = num(d.width) ?? 280;
    const h = num(d.height) ?? (c.tag === 'textarea' ? 80 : 40);
    const frame = createFrame(
      { parentId, width: w, height: h, name: c.tag === 'textarea' ? 'Textarea' : c.tag === 'select' ? 'Select' : 'Input' },
      {
        role: 'input',
        layoutPositioning: parent ? 'auto' : 'absolute',
        fills: paints(d).length ? paints(d) : [solid('#FFFFFF')],
        stroke: { color: d.borderColor ?? '#E5E5E5', opacity: 1, width: d.borderWidth ?? 1, visible: true },
        radius: radius4(d.radius ?? 6),
        clipContent: true,
        layout: { mode: 'horizontal', gap: 8, padding: hasPad ? [d.pt ?? 0, d.pr ?? 0, d.pb ?? 0, d.pl ?? 0] : [8, 12, 8, 12], primaryAlign: c.tag === 'select' ? 'space-between' : 'start', counterAlign: c.tag === 'textarea' ? 'start' : 'center', wrap: false },
        sizing: { horizontal: num(d.width) !== undefined ? 'fixed' : parent && (d.width === 'fill' || (parent.mode === 'vertical' && parent.stretch) || parent.gridCell || (parent.mode === 'horizontal' && d.grow)) ? 'fill' : 'fixed', vertical: num(d.height) !== undefined || c.tag === 'textarea' ? 'fixed' : 'hug' },
        visible: !d.hidden,
      },
    );
    const nodes: DesignNode[] = [frame];
    if (placeholder) {
      const tp = textProps({ ...eff, fontSize: d.fontSize ?? eff.fontSize ?? 14, lineHeight: d.lineHeight ?? 20 });
      const text = createText(
        { parentId: frame.id, name: 'Placeholder' },
        { ...tp, characters: placeholder.slice(0, 500), role: 'span', layoutPositioning: 'auto', fills: [solid(muted ? '#737373' : (eff.color ?? '#0A0A0A'))], sizing: { horizontal: 'hug', vertical: 'hug' } },
      );
      frame.childIds.push(text.id);
      nodes.push(text);
    }
    if (c.tag === 'select') {
      const chevron = createIcon({ parentId: frame.id, width: 16, height: 16, name: 'Chevron' }, 'chevron-down', { layoutPositioning: 'auto', fills: [solid('#737373')] });
      frame.childIds.push(chevron.id);
      nodes.push(chevron);
    }
    if (m.hidden !== d.hidden) frame.responsive['bp-mobile'] = { visible: !m.hidden };
    return { nodes, w, h };
  }
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

type CNode = ElNode | TextC | IconNodeC;
interface ElNode {
  t: 'el';
  tag: string;
  className: string;
  style: Record<string, V> | null;
  attrs: Record<string, V>;
  children: CNode[];
  tailwind: boolean;
  ext?: string;
}
interface TextC {
  t: 'text';
  text: string;
  placeholder?: boolean;
}
interface IconNodeC {
  t: 'icon';
  icon: IconName;
  name: string;
  className: string;
  attrs: Record<string, V>;
}
interface ParentInfo {
  mode: 'vertical' | 'horizontal';
  /** Children stretch across the cross axis by default (CSS align-items: stretch / block flow). */
  stretch: boolean;
  /** Block formatting context (not flex/grid): inline children keep their content width. */
  block: boolean;
  gridCell?: boolean;
}
interface Inh {
  d: StyleSpec;
  m: StyleSpec;
}
interface Built {
  nodes: DesignNode[];
  w: number;
  h: number;
}

const NO_PAD: FrameNode['layout'] = { mode: 'vertical', gap: 0, padding: [0, 0, 0, 0], primaryAlign: 'start', counterAlign: 'start', wrap: false };

const SKIP_TAGS = new Set(['script', 'style', 'template', 'noscript', 'head', 'meta', 'link', 'title', 'iframe', 'object', 'embed', 'canvas', 'video', 'audio', 'source', 'track', 'path', 'circle', 'defs']);
const INLINE_TEXT = new Set(['span', 'strong', 'b', 'em', 'i', 'a', 'code', 'small', 'mark', 'u', 's', 'sub', 'sup', 'br', 'abbr', 'time', 'kbd', 'q', 'cite', 'del', 'ins']);
const TEXT_TAGS = new Set([...INLINE_TEXT, 'label', 'button']);
const BLOCK_TEXT_TAGS = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'div', 'li', 'dt', 'dd', 'blockquote', 'figcaption', 'caption', 'td', 'th', 'legend', 'summary', 'pre']);
const INLINE_TAGS = new Set([...INLINE_TEXT, 'label', 'button', 'img', 'svg', 'input', 'select', 'textarea']);
const SECTION_TAGS = new Set(['section', 'header', 'footer', 'nav', 'main', 'aside']);

const FRAME_ROLE: Record<string, FrameNode['role']> = {
  section: 'section',
  header: 'header',
  nav: 'nav',
  main: 'main',
  footer: 'footer',
  aside: 'aside',
  article: 'article',
  button: 'button',
  a: 'link',
  form: 'div',
};
const TEXT_ROLE: Record<string, TextNode['role']> = { h1: 'h1', h2: 'h2', h3: 'h3', h4: 'h4', h5: 'h5', h6: 'h6', p: 'p', label: 'label', a: 'a', span: 'span', strong: 'span', em: 'span', small: 'span', code: 'span' };

function tagDefaults(tag: string, tailwind: boolean): StyleSpec {
  const s: StyleSpec = {};
  if (/^h[1-6]$/.test(tag) && !tailwind) {
    const sizes: Record<string, number> = { h1: 32, h2: 24, h3: 18.72, h4: 16, h5: 13.28, h6: 10.72 };
    s.fontSize = sizes[tag];
    s.fontWeight = 700;
    s.lineHeight = undefined;
  }
  if (tag === 'strong' || tag === 'b' || tag === 'th') s.fontWeight = 700;
  if (tag === 'em' || tag === 'i' || tag === 'cite') s.italic = true;
  if (tag === 'code' || tag === 'pre' || tag === 'kbd') s.fontFamily = 'mono';
  if ((tag === 'ul' || tag === 'ol') && !tailwind) s.pl = 40;
  if (tag === 'small') s.fontSize = 13;
  return s;
}

function stripUndef<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}

function pick(s: StyleSpec, keys: (keyof StyleSpec)[]): StyleSpec {
  const out: StyleSpec = {};
  for (const k of keys) if (s[k] !== undefined) (out as Record<string, unknown>)[k] = s[k];
  // A font-size utility also resets the inherited line height.
  if (s.fontSize !== undefined && s.lineHeight === undefined && s.lineHeightRatio === undefined) out.lineHeight = undefined;
  return out;
}

function hasBox(s: StyleSpec): boolean {
  return !!(s.bg || s.gradient || s.borderWidth || s.shadow || s.pt || s.pr || s.pb || s.pl || s.display === 'flex' || s.display === 'grid' || (typeof s.height === 'number' && s.height > 0) || s.minHeight);
}

const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && /^\d+(\.\d+)?$/.test(v) ? Number(v) : undefined);

function hSizing(s: StyleSpec, parent: ParentInfo | null, inline: boolean): 'fixed' | 'hug' | 'fill' {
  if (num(s.width) !== undefined) return 'fixed';
  if (s.width === 'hug') return 'hug';
  if (!parent) return inline ? 'hug' : 'fixed';
  if (s.width === 'fill') return 'fill';
  if (s.absolute) return 'hug';
  if (parent.gridCell) return 'fill';
  if (parent.mode === 'vertical') return parent.stretch && !(parent.block && inline) ? 'fill' : 'hug';
  return s.grow ? 'fill' : 'hug';
}

function vSizing(s: StyleSpec, parent: ParentInfo | null, _frame: boolean): 'fixed' | 'hug' | 'fill' {
  if (num(s.height) !== undefined) return 'fixed';
  if (s.height === 'fill' && parent) return 'fill';
  if (parent?.mode === 'horizontal' && parent.stretch && !parent.block && !parent.gridCell) return 'fill';
  return 'hug';
}

function textProps(s: StyleSpec): Pick<TextNode, 'fontFamily' | 'fontSize' | 'fontWeight' | 'italic' | 'lineHeight' | 'letterSpacing' | 'textAlign' | 'textDecoration' | 'textCase' | 'fills'> {
  const fontSize = Math.min(2000, Math.max(1, s.fontSize ?? 16));
  const lineHeight: TextNode['lineHeight'] = s.lineHeight !== undefined ? { unit: 'px', value: s.lineHeight } : { unit: 'percent', value: Math.round((s.lineHeightRatio ?? 1.5) * 100) };
  return {
    fontFamily: s.fontFamily === 'serif' ? 'Playfair Display' : s.fontFamily === 'mono' ? 'JetBrains Mono' : 'Inter',
    fontSize,
    fontWeight: Math.min(900, Math.max(100, Math.round((s.fontWeight ?? 400) / 100) * 100)),
    italic: !!s.italic,
    lineHeight,
    letterSpacing: Math.round((s.letterSpacing ?? (s.letterSpacingEm ?? 0) * fontSize) * 100) / 100,
    textAlign: s.textAlign ?? 'left',
    textDecoration: s.decoration && s.decoration !== 'none' ? s.decoration : 'none',
    textCase: s.textCase ?? 'none',
    fills: [solid(s.color ?? '#0A0A0A', s.colorOpacity ?? 1)],
  };
}

function paints(s: StyleSpec): Paint[] {
  if (s.gradient && (s.gradient.from || s.gradient.to)) {
    const from = s.gradient.from ?? s.gradient.to!;
    const to = s.gradient.to ?? s.gradient.from!;
    const stops = s.gradient.via
      ? [
          { color: from, position: 0 },
          { color: s.gradient.via, position: 0.5 },
          { color: to, position: 1 },
        ]
      : [
          { color: from, position: 0 },
          { color: to, position: 1 },
        ];
    return [{ type: 'linear-gradient', angle: s.gradient.angle, stops, opacity: 1, visible: true }];
  }
  if (s.bg) return [solid(s.bg, s.bgOpacity ?? 1)];
  return [];
}

function radius4(r: number | undefined): [number, number, number, number] {
  const v = Math.min(999, Math.max(0, r ?? 0));
  return [v, v, v, v];
}

const SHADOWS: Record<string, Omit<Effect, 'type' | 'visible' | 'color' | 'x'>> = {
  sm: { y: 1, blur: 2, spread: 0, opacity: 0.05 },
  md: { y: 4, blur: 6, spread: -1, opacity: 0.1 },
  lg: { y: 10, blur: 15, spread: -3, opacity: 0.1 },
  xl: { y: 20, blur: 25, spread: -5, opacity: 0.1 },
  '2xl': { y: 25, blur: 50, spread: -12, opacity: 0.25 },
};
function shadow(s: StyleSpec['shadow']): Effect[] {
  if (!s) return [];
  return [{ type: 'drop-shadow', x: 0, color: '#000000', visible: true, ...SHADOWS[s]! }];
}

function textOf(c: ElNode): string {
  return c.children
    .map(textOfNode)
    .join('')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .trim();
}
function textOfNode(c: CNode): string {
  if (c.t === 'text') return c.text;
  if (c.t === 'el') return c.tag === 'br' ? '\n' : textOf(c);
  return '';
}

function nameFor(c: ElNode): string {
  const map: Record<string, string> = { div: 'Container', ul: 'List', ol: 'List', li: 'Item', form: 'Form', button: 'Button', a: 'Link', section: 'Section', header: 'Header', footer: 'Footer', nav: 'Navbar', main: 'Main', aside: 'Aside', article: 'Article', label: 'Label', span: 'Container' };
  return map[c.tag] ?? humanize(c.tag);
}

function jsxText(raw: string): string {
  // JSX whitespace rules: lines are trimmed, line breaks between text become spaces.
  const lines = raw.split(/\r\n|\n|\r/);
  if (lines.length === 1) return raw;
  return lines
    .map((l, i) => {
      let s = l.replace(/\t/g, ' ');
      if (i !== 0) s = s.replace(/^ +/, '');
      if (i !== lines.length - 1) s = s.replace(/ +$/, '');
      return s;
    })
    .filter(Boolean)
    .join(' ');
}

function jsxMemberName(n: t.JSXMemberExpression): string {
  const obj = n.object.type === 'JSXIdentifier' ? n.object.name : jsxMemberName(n.object);
  return `${obj}.${n.property.name}`;
}

function truthy(v: V): boolean {
  if (v instanceof Unknown) return true;
  if (Array.isArray(v)) return true;
  return !!v;
}

function classJoin(args: V[]): string {
  const out: string[] = [];
  const visit = (v: V) => {
    if (typeof v === 'string') out.push(v);
    else if (typeof v === 'number') out.push(String(v));
    else if (Array.isArray(v)) v.forEach(visit);
    else if (isObj(v)) for (const [k, on] of Object.entries(v)) if (on === true || (on !== undefined && on !== null && on !== false && !(on instanceof Unknown) && truthy(on))) out.push(k);
  };
  args.forEach(visit);
  return out.join(' ').replace(/\s+/g, ' ').trim();
}

function singular(s: string): string {
  if (s.endsWith('ies')) return `${s.slice(0, -3)}y`;
  if (s.endsWith('s') && s.length > 3) return s.slice(0, -1);
  return s;
}

function fileBase(path: string): string {
  const base = path.split('/').pop()!.replace(/\.(t|j)sx?$/, '');
  const pascal = base.replace(/(^|[-_. ])(\w)/g, (_, __, c: string) => c.toUpperCase());
  return /^[A-Z]/.test(pascal) ? pascal : `Component${pascal}`;
}
