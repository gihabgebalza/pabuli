/* 수식 노트 계산 엔진
 * MathLive가 만들어 내는 LaTeX를 직접 파싱해서 계산한다.
 *  - 수치 계산, 함수, 행렬/벡터
 *  - 정적분(수치), 미분(기호), 극한(수치), 합/곱
 *  - 방정식·부등식(한 변수, 수치 탐색), 연립방정식(선형: 정확, 비선형: 뉴턴법)
 * 브라우저와 Node 양쪽에서 동작한다.
 */
const MathNote = (() => {
  'use strict';

  class MErr extends Error {
    constructor(msg, code) { super(msg); this.code = code || 'error'; }
  }

  // ------------------------------------------------------------------
  // 정규화 & 토크나이저
  // ------------------------------------------------------------------
  const GREEK = ('alpha beta gamma delta epsilon varepsilon zeta eta theta vartheta iota kappa ' +
    'lambda mu nu xi rho sigma tau upsilon phi varphi chi psi omega Gamma Delta Theta Lambda ' +
    'Xi Sigma Phi Psi Omega').split(' ');
  const FUNC_CMDS = new Set(('sin cos tan cot sec csc arcsin arccos arctan sinh cosh tanh coth ' +
    'ln log lg exp det max min gcd lcm tr abs floor ceil sgn round arsinh arcosh artanh').split(' '));
  const INVERSE = { sin: 'arcsin', cos: 'arccos', tan: 'arctan', sinh: 'arsinh', cosh: 'arcosh', tanh: 'artanh' };
  const OP_CMDS = {
    cdot: 'cdot', times: 'times', div: 'div', ast: '*', pm: 'pm', mp: 'pm',
    le: '<=', leq: '<=', leqslant: '<=', ge: '>=', geq: '>=', geqslant: '>=',
    ne: '!=', neq: '!=', approx: '≈', lt: '<', gt: '>',
    to: 'to', rightarrow: 'to', longrightarrow: 'to', mapsto: 'to', prime: "'",
  };

  function normalize(s) {
    s = String(s);
    const uni = { '×': '\\times ', '·': '\\cdot ', '÷': '\\div ', '−': '-', '≤': '\\le ', '≥': '\\ge ',
      '≠': '\\ne ', 'π': '\\pi ', '∞': '\\infty ', '√': '\\sqrt ', '°': '^{\\circ}', '→': '\\to ', '±': '\\pm ' };
    s = s.replace(/[×·÷−≤≥≠π∞√°→±]/g, (c) => uni[c]);
    s = s.replace(/\\placeholder(\[[^\]]*\])?\{[^}]*\}/g, ' \\placeholder ');
    s = s.replace(/\\(left|right)\s*\./g, ' ');
    s = s.replace(/\\(left|right|mleft|mright|bigl|bigr|Bigl|Bigr|biggl|biggr|big|Big|bigg)(?![a-zA-Z])/g, ' ');
    s = s.replace(/\\(mathrm|operatorname|mathit|text|textrm|mathnormal)\s*\{\s*d\s*\}/g, ' \\dd ');
    s = s.replace(/\\differentialD(?![a-zA-Z])/g, ' \\dd ');
    s = s.replace(/\\exponentialE(?![a-zA-Z])/g, ' e ');
    s = s.replace(/\\imaginaryI(?![a-zA-Z])/g, ' i ');
    s = s.replace(/\\(displaystyle|textstyle|limits|nolimits)(?![a-zA-Z])/g, ' ');
    s = s.replace(/\\(,|;|:|!|>| )/g, ' ').replace(/\\(quad|qquad)(?![a-zA-Z])/g, ' ').replace(/~/g, ' ');
    s = s.replace(/\\(d|t)frac(?![a-zA-Z])/g, '\\frac');
    s = s.replace(/\\(lvert|rvert|vert|mid|lVert|rVert|Vert)(?![a-zA-Z])/g, '|').replace(/\\\|/g, '|');
    s = s.replace(/\\(mathrm|mathit|operatorname|mathnormal)\s*\{\s*([a-zA-Z]+)\s*\}/g,
      (m, c, name) => (name.length === 1 ? ` ${name} ` : ` \\${name} `));
    s = s.replace(/\^\s*\{\s*\\circ\s*\}|\^\s*\\circ(?![a-zA-Z])|\\degree(?![a-zA-Z])/g, ' \\degsym ');
    s = s.replace(/\^\s*\{\s*\+\s*\}|\^\s*\+/g, ' \\sideplus ');
    s = s.replace(/\^\s*\{\s*-\s*\}|\^\s*-(?![0-9a-zA-Z{\\(])/g, ' \\sideminus ');
    s = s.replace(/\\%/g, ' \\pct ');
    s = s.replace(/\{\s*,\s*\}/g, '.');
    return s;
  }

  function tokenize(s) {
    const toks = [];
    let i = 0;
    const n = s.length;
    const push = (k, v) => toks.push({ k, v });
    while (i < n) {
      const ch = s[i];
      if (/\s/.test(ch)) { i++; continue; }
      const prev = toks[toks.length - 1];
      const scriptSingle = prev && prev.k === 'op' && (prev.v === '^' || prev.v === '_');
      if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(s[i + 1] || ''))) {
        if (scriptSingle) { push('num', Number(ch)); i++; continue; }
        let j = i, dot = false;
        while (j < n && (/[0-9]/.test(s[j]) || (s[j] === '.' && !dot))) { if (s[j] === '.') dot = true; j++; }
        push('num', Number(s.slice(i, j)));
        i = j;
        continue;
      }
      if (/[a-zA-Z]/.test(ch)) { push('id', ch); i++; continue; }
      if (ch === '\\') {
        const nx = s[i + 1];
        if (nx === '\\') { push('nl'); i += 2; continue; }
        if (nx === '{') { push('op', '('); i += 2; continue; }
        if (nx === '}') { push('op', ')'); i += 2; continue; }
        if (/[a-zA-Z]/.test(nx || '')) {
          let j = i + 1;
          while (j < n && /[a-zA-Z]/.test(s[j])) j++;
          const name = s.slice(i + 1, j);
          i = j;
          if (name === 'begin' || name === 'end') {
            const m = /^\s*\{([a-zA-Z*]+)\}/.exec(s.slice(i));
            if (!m) throw new MErr('환경 이름이 올바르지 않습니다');
            i += m[0].length;
            push(name, m[1].replace('*', ''));
            continue;
          }
          if (name === 'placeholder') { push('ph'); continue; }
          if (name === 'dd') { push('dd'); continue; }
          if (name === 'degsym') { push('deg'); continue; }
          if (name === 'pct') { push('pct'); continue; }
          if (name === 'sideplus') { push('side', '+'); continue; }
          if (name === 'sideminus') { push('side', '-'); continue; }
          if (OP_CMDS[name]) { push('op', OP_CMDS[name]); continue; }
          if (GREEK.includes(name)) { push('id', '\\' + name); continue; }
          push('cmd', name);
          continue;
        }
        throw new MErr(`알 수 없는 기호: \\${nx || ''}`);
      }
      if ('+-*/^_!=<>&,|\'()[]{}'.includes(ch)) { push('op', ch); i++; continue; }
      throw new MErr(`알 수 없는 기호: ${ch}`);
    }
    toks.push({ k: 'eof' });
    return toks;
  }

  // ------------------------------------------------------------------
  // 파서
  // ------------------------------------------------------------------
  const RELOPS = new Set(['=', '<', '>', '<=', '>=', '!=', '≈']);

  class Parser {
    constructor(toks) { this.t = toks; this.i = 0; this.abs = 0; this.stopDiff = 0; }
    peek(o = 0) { return this.t[Math.min(this.i + o, this.t.length - 1)]; }
    next() { const t = this.t[this.i]; if (this.i < this.t.length - 1) this.i++; return t; }
    is(k, v) { const t = this.peek(); return t.k === k && (v === undefined || t.v === v); }
    isOp(v) { return this.is('op', v); }
    expectOp(v, msg) {
      if (!this.isOp(v)) {
        if (this.is('eof') && (v === ')' || v === ']')) return; // 닫는 괄호 생략 허용
        throw new MErr(msg || `'${v}'이(가) 필요합니다`);
      }
      this.next();
    }

    parseTop() {
      if (this.is('eof')) throw new MErr('수식이 비어 있습니다', 'empty');
      const items = [this.parseRelation()];
      while (this.is('nl') || this.isOp(',') || this.isOp(';')) {
        this.next();
        if (this.is('eof')) break;
        items.push(this.parseRelation());
      }
      if (!this.is('eof')) {
        const t = this.peek();
        if (t.k === 'op' && (t.v === ')' || t.v === ']')) throw new MErr('괄호 짝이 맞지 않습니다');
        throw new MErr(`예상치 못한 기호: ${t.v ?? t.k}`);
      }
      return items.length > 1 ? { t: 'system', items } : items[0];
    }

    parseRelation() {
      const parts = [this.parseExpr()];
      const ops = [];
      while (this.peek().k === 'op' && RELOPS.has(this.peek().v)) {
        ops.push(this.next().v);
        if (this.is('eof') || this.is('nl') || this.is('end')) {
          if (ops[ops.length - 1] === '=' && ops.length === 1) return { t: 'cmp', ops, parts, trailingEq: true };
          throw new MErr('식이 완성되지 않았습니다');
        }
        parts.push(this.parseExpr());
      }
      return ops.length ? { t: 'cmp', ops, parts } : parts[0];
    }

    parseExpr() {
      let a = this.parseTerm();
      for (;;) {
        if (this.isOp('+')) { this.next(); a = { t: 'add', a, b: this.parseTerm() }; }
        else if (this.isOp('-')) { this.next(); a = { t: 'sub', a, b: this.parseTerm() }; }
        else if (this.isOp('pm')) { this.next(); a = { t: 'pm', a, b: this.parseTerm() }; }
        else return a;
      }
    }

    startsFactor() {
      const t = this.peek();
      if (['num', 'id', 'cmd', 'begin', 'ph'].includes(t.k)) return true;
      if (t.k === 'op') {
        if (t.v === '(' || t.v === '[' || t.v === '{') return true;
        if (t.v === '|') return this.abs === 0;
      }
      return false;
    }

    diffAhead() {
      const t = this.peek();
      if (t.k === 'dd') return true;
      return t.k === 'id' && t.v === 'd' && this.peek(1).k === 'id';
    }

    parseTerm() {
      let a = this.parseSigned();
      const MAP = { '*': 'mul', cdot: 'dot', times: 'cross', div: 'div', '/': 'div' };
      for (;;) {
        const t = this.peek();
        if (t.k === 'op' && MAP[t.v]) {
          this.next();
          a = { t: MAP[t.v], a, b: this.parseSigned() };
        } else if (this.startsFactor()) {
          if (this.stopDiff && this.diffAhead()) return a;
          a = { t: 'mul', a, b: this.parsePower(), implicit: true };
        } else if (this.is('dd') && this.stopDiff) {
          return a;
        } else return a;
      }
    }

    parseSigned() {
      if (this.isOp('-')) { this.next(); return { t: 'neg', a: this.parseSigned() }; }
      if (this.isOp('+')) { this.next(); return this.parseSigned(); }
      return this.parsePower();
    }

    parsePower() {
      let base = this.parsePostfix();
      while (this.isOp('^')) {
        this.next();
        // 전치: A^T, A^{T}, A^\top
        if ((this.isOp('{') && this.peek(1).k === 'id' && this.peek(1).v === 'T' && this.peek(2).k === 'op' && this.peek(2).v === '}') ||
            (this.isOp('{') && this.peek(1).k === 'cmd' && this.peek(1).v === 'top')) {
          this.next(); this.next(); this.next();
          base = { t: 'transpose', a: base };
        } else if ((this.is('id', 'T')) || this.is('cmd', 'top')) {
          this.next();
          base = { t: 'transpose', a: base };
        } else {
          base = { t: 'pow', a: base, b: this.parseScriptArg() };
        }
        base = this.parsePostfixOps(base);
      }
      return base;
    }

    parseScriptArg() {
      if (this.isOp('{')) {
        this.next();
        const save = this.stopDiff; this.stopDiff = 0;
        const e = this.parseExpr();
        this.stopDiff = save;
        this.expectOp('}');
        return e;
      }
      if (this.isOp('-')) { this.next(); return { t: 'neg', a: this.parsePrimary() }; }
      return this.parsePrimary();
    }

    parsePostfix() { return this.parsePostfixOps(this.parsePrimary()); }

    parsePostfixOps(a) {
      for (;;) {
        if (this.isOp('!')) { this.next(); a = { t: 'fact', a }; }
        else if (this.is('deg')) { this.next(); a = { t: 'deg', a }; }
        else if (this.is('pct')) { this.next(); a = { t: 'pct', a }; }
        else return a;
      }
    }

    readSubscriptName() {
      // x_1, x_{12}, a_{n} → 이름 문자열
      if (!this.isOp('_')) return '';
      this.next();
      if (this.isOp('{')) {
        this.next();
        let s = '';
        while (!this.isOp('}') && !this.is('eof')) {
          const t = this.next();
          s += t.v === undefined ? '' : String(t.v);
        }
        this.expectOp('}');
        return `_{${s}}`;
      }
      const t = this.next();
      return `_{${t.v}}`;
    }

    parseParenContents(close) {
      const save = this.stopDiff; this.stopDiff = 0;
      const saveAbs = this.abs; this.abs = 0;
      const items = [this.parseExpr()];
      while (this.isOp(',')) { this.next(); items.push(this.parseExpr()); }
      this.stopDiff = save; this.abs = saveAbs;
      this.expectOp(close, '괄호 짝이 맞지 않습니다');
      return items;
    }

    parsePrimary() {
      const t = this.next();
      switch (t.k) {
        case 'num': return { t: 'num', v: t.v };
        case 'ph': throw new MErr('빈칸(□)을 채워 주세요', 'incomplete');
        case 'eof': throw new MErr('수식이 완성되지 않았습니다', 'incomplete');
        case 'dd': throw new MErr('d 기호 위치가 올바르지 않습니다');
        case 'begin': return this.parseEnv(t.v);
        case 'id': {
          const name = t.v + this.readSubscriptName();
          let primes = 0;
          while (this.isOp("'")) { this.next(); primes++; }
          if (this.isOp('(') && (primes || /^[a-zA-Z]$/.test(name))) {
            this.next();
            const args = this.parseParenContents(')');
            return { t: 'apply', name, args, primes };
          }
          if (primes) throw new MErr(`${name}' 뒤에 (x)가 필요합니다`);
          return { t: 'var', name };
        }
        case 'cmd': return this.parseCommand(t.v);
        case 'op': {
          if (t.v === '(' || t.v === '[') {
            const items = this.parseParenContents(t.v === '(' ? ')' : ']');
            if (items.length > 1) return { t: 'matrix', rows: items.map((x) => [x]), tuple: true };
            return { t: 'group', a: items[0] };
          }
          if (t.v === '{') {
            const save = this.stopDiff; this.stopDiff = 0;
            const e = this.parseExpr();
            this.stopDiff = save;
            this.expectOp('}');
            return e;
          }
          if (t.v === '|') {
            this.abs++;
            const save = this.stopDiff; this.stopDiff = 0;
            const e = this.parseExpr();
            this.stopDiff = save;
            this.abs--;
            if (!this.isOp('|')) throw new MErr('절댓값 기호 짝이 맞지 않습니다');
            this.next();
            return { t: 'abs', a: e };
          }
          break;
        }
        default: break;
      }
      throw new MErr(`예상치 못한 기호: ${t.v ?? t.k}`);
    }

    parseGroupOrAtom() {
      if (this.isOp('{')) {
        this.next();
        const save = this.stopDiff; this.stopDiff = 0;
        const e = this.parseExpr();
        this.stopDiff = save;
        this.expectOp('}');
        return e;
      }
      return this.parsePrimary();
    }

    parseCommand(name) {
      if (name === 'pi') return { t: 'const', name: 'pi' };
      if (name === 'infty') return { t: 'num', v: Infinity };
      if (name === 'frac') return this.tryDerivFrac() || { t: 'div', a: this.parseGroupOrAtom(), b: this.parseGroupOrAtom() };
      if (name === 'sqrt') {
        let n = null;
        if (this.isOp('[')) { this.next(); n = this.parseExpr(); this.expectOp(']'); }
        const a = this.parseGroupOrAtom();
        return n ? { t: 'root', a, n } : { t: 'call', f: 'sqrt', args: [a] };
      }
      if (name === 'binom') return { t: 'call', f: 'nCr', args: [this.parseGroupOrAtom(), this.parseGroupOrAtom()] };
      if (FUNC_CMDS.has(name)) return this.parseFunc(name);
      if (name === 'int') return this.parseIntegral();
      if (name === 'sum' || name === 'prod') return this.parseBig(name);
      if (name === 'lim') return this.parseLim();
      throw new MErr(`'\\${name}' 기호는 계산하지 않습니다`, 'unsupported');
    }

    // \frac{d}{dx}, \frac{d^2}{dx^2}, \frac{\partial}{\partial x}
    tryDerivFrac() {
      const T = this.t;
      let j = this.i;
      const isD = (tok) => tok.k === 'dd' || (tok.k === 'id' && tok.v === 'd') || (tok.k === 'cmd' && tok.v === 'partial');
      const readOrder = () => {
        if (T[j].k === 'op' && T[j].v === '^') {
          j++;
          if (T[j].k === 'num') return T[j++].v;
          if (T[j].k === 'op' && T[j].v === '{' && T[j + 1].k === 'num' && T[j + 2].k === 'op' && T[j + 2].v === '}') {
            const v = T[j + 1].v; j += 3; return v;
          }
          return null;
        }
        return 1;
      };
      if (!(T[j].k === 'op' && T[j].v === '{')) return null;
      j++;
      if (!isD(T[j])) return null;
      j++;
      const n1 = readOrder();
      if (n1 == null || !(T[j].k === 'op' && T[j].v === '}')) return null;
      j++;
      if (!(T[j].k === 'op' && T[j].v === '{')) return null;
      j++;
      if (!isD(T[j])) return null;
      j++;
      if (T[j].k !== 'id') return null;
      const v = T[j].v;
      j++;
      const n2 = readOrder();
      if (n2 == null || !(T[j].k === 'op' && T[j].v === '}')) return null;
      j++;
      if (n1 !== n2) throw new MErr('미분 차수가 위아래 다릅니다');
      this.i = j;
      if (this.is('eof')) throw new MErr('미분할 식을 입력해 주세요', 'incomplete');
      const a = this.parseTerm();
      return { t: 'deriv', v, n: n1, a };
    }

    parseFunc(name) {
      let power = null, inverse = false, base = null;
      for (let k = 0; k < 2; k++) {
        if (this.isOp('^')) {
          this.next();
          const p = this.parseScriptArg();
          if (p.t === 'neg' && p.a.t === 'num' && p.a.v === 1) inverse = true; else power = p;
        } else if (this.isOp('_')) {
          this.next();
          base = this.parseScriptArg();
        }
      }
      let args;
      if (this.isOp('(')) {
        this.next();
        args = this.parseParenContents(')');
      } else {
        if (this.is('eof')) throw new MErr(`${name} 뒤에 값을 입력해 주세요`, 'incomplete');
        let arg = this.parsePower();
        while ((this.is('num') || this.is('id')) && !(this.stopDiff && this.diffAhead())) {
          arg = { t: 'mul', a: arg, b: this.parsePower(), implicit: true };
        }
        args = [arg];
      }
      let f = name;
      if (inverse) {
        if (!INVERSE[name]) throw new MErr(`${name}의 역함수는 지원하지 않습니다`);
        f = INVERSE[name];
      }
      let node = { t: 'call', f, args, base };
      if (power) node = { t: 'pow', a: node, b: power };
      return node;
    }

    parseLimits() {
      let lo = null, hi = null;
      for (let k = 0; k < 2; k++) {
        if (this.isOp('_') && lo === null) { this.next(); lo = this.parseScriptArg(); }
        else if (this.isOp('^') && hi === null) { this.next(); hi = this.parseScriptArg(); }
      }
      return { lo, hi };
    }

    parseIntegral() {
      const { lo, hi } = this.parseLimits();
      if ((lo === null) !== (hi === null)) throw new MErr('적분 구간의 위끝과 아래끝을 모두 입력해 주세요', 'incomplete');
      this.stopDiff++;
      const saveAbs = this.abs; this.abs = 0;
      const a = this.parseExpr();
      this.abs = saveAbs;
      this.stopDiff--;
      if (this.is('dd')) this.next();
      else if (this.is('id', 'd')) this.next();
      else throw new MErr('적분 변수(dx)가 필요합니다', 'incomplete');
      if (!this.is('id')) throw new MErr('적분 변수(dx)가 필요합니다', 'incomplete');
      const v = this.next().v;
      return { t: 'int', v, lo, hi, a };
    }

    parseBig(kind) {
      let v = null, lo = null, hi = null;
      for (let k = 0; k < 2; k++) {
        if (this.isOp('_')) {
          this.next();
          this.expectOp('{', '합의 아래끝은 n=1 형태로 입력해 주세요');
          if (!this.is('id')) throw new MErr('합의 아래끝은 n=1 형태로 입력해 주세요');
          v = this.next().v + this.readSubscriptName();
          this.expectOp('=', '합의 아래끝은 n=1 형태로 입력해 주세요');
          lo = this.parseExpr();
          this.expectOp('}');
        } else if (this.isOp('^')) {
          this.next();
          hi = this.parseScriptArg();
        }
      }
      if (v === null || hi === null) throw new MErr('합/곱의 범위(아래·위)를 입력해 주세요', 'incomplete');
      const a = this.parseTerm();
      return { t: kind, v, lo, hi, a };
    }

    parseLim() {
      if (!this.isOp('_')) throw new MErr('극한은 \\lim_{x\\to a} 형태로 입력해 주세요', 'incomplete');
      this.next();
      this.expectOp('{');
      if (!this.is('id')) throw new MErr('극한 변수가 필요합니다');
      const v = this.next().v;
      this.expectOp('to', '→ 기호가 필요합니다');
      const to = this.parseExpr();
      let side = null;
      if (this.is('side')) side = this.next().v;
      this.expectOp('}');
      const a = this.parseTerm();
      return { t: 'lim', v, to, side, a };
    }

    parseEnv(env) {
      const MATRIX = ['pmatrix', 'bmatrix', 'Bmatrix', 'vmatrix', 'Vmatrix', 'matrix', 'smallmatrix', 'array'];
      if (MATRIX.includes(env)) {
        if (env === 'array' && this.isOp('{')) { while (!this.isOp('}') && !this.is('eof')) this.next(); this.next(); }
        const rows = [];
        let row = [];
        for (;;) {
          if (this.is('end')) { this.next(); break; }
          if (this.is('eof')) throw new MErr('행렬이 닫히지 않았습니다');
          row.push(this.parseExpr());
          if (this.isOp('&')) { this.next(); continue; }
          if (this.is('nl')) { this.next(); rows.push(row); row = []; continue; }
          if (!this.is('end')) throw new MErr(`행렬 안에 예상치 못한 기호: ${this.peek().v}`);
        }
        if (row.length) rows.push(row);
        if (!rows.length) throw new MErr('빈 행렬입니다');
        const w = rows[0].length;
        if (rows.some((r) => r.length !== w)) throw new MErr('행렬의 각 행의 칸 수가 같아야 합니다');
        const node = { t: 'matrix', rows };
        return env === 'vmatrix' || env === 'Vmatrix' ? { t: 'call', f: 'det', args: [node], bars: true } : node;
      }
      if (['cases', 'aligned', 'align', 'gathered', 'gather', 'split', 'rcases', 'dcases', 'eqnarray'].includes(env)) {
        const items = [];
        for (;;) {
          if (this.is('end')) { this.next(); break; }
          if (this.is('eof')) throw new MErr('연립식이 닫히지 않았습니다');
          if (this.isOp('&') || this.is('nl') || this.isOp(',')) { this.next(); continue; }
          items.push(this.parseRelation());
        }
        return { t: 'system', items };
      }
      throw new MErr(`'${env}' 형식은 계산하지 않습니다`, 'unsupported');
    }
  }

  function parse(latex) {
    return new Parser(tokenize(normalize(latex))).parseTop();
  }

  // ------------------------------------------------------------------
  // 값 & 연산
  // ------------------------------------------------------------------
  const isMat = (v) => v && typeof v === 'object' && Array.isArray(v.m);
  const mat = (m) => ({ m });
  const dims = (A) => [A.m.length, A.m[0].length];
  const isVec = (A) => isMat(A) && (A.m.length === 1 || A.m[0].length === 1);
  const vecList = (A) => (A.m.length === 1 ? A.m[0].slice() : A.m.map((r) => r[0]));

  function chkNum(v) {
    if (typeof v === 'number' && Number.isNaN(v)) throw new MErr('정의되지 않는 값입니다 (정의역 밖)');
    return v;
  }

  function add(a, b, sign = 1) {
    if (!isMat(a) && !isMat(b)) return a + sign * b;
    if (isMat(a) && isMat(b)) {
      const [r1, c1] = dims(a), [r2, c2] = dims(b);
      if (r1 !== r2 || c1 !== c2) throw new MErr(`크기가 다른 행렬은 더할 수 없습니다 (${r1}×${c1}, ${r2}×${c2})`);
      return mat(a.m.map((row, i) => row.map((x, j) => x + sign * b.m[i][j])));
    }
    throw new MErr('행렬과 숫자는 더하거나 뺄 수 없습니다');
  }

  function mul(a, b) {
    if (!isMat(a) && !isMat(b)) return a * b;
    if (!isMat(a)) return mat(b.m.map((r) => r.map((x) => a * x)));
    if (!isMat(b)) return mat(a.m.map((r) => r.map((x) => x * b)));
    const [r1, c1] = dims(a), [r2, c2] = dims(b);
    if (c1 !== r2) {
      if (isVec(a) && isVec(b) && vecList(a).length === vecList(b).length) return dot(a, b);
      throw new MErr(`행렬 곱셈 크기가 맞지 않습니다 (${r1}×${c1} · ${r2}×${c2})`);
    }
    const out = [];
    for (let i = 0; i < r1; i++) {
      out.push([]);
      for (let j = 0; j < c2; j++) {
        let s = 0;
        for (let k = 0; k < c1; k++) s += a.m[i][k] * b.m[k][j];
        out[i].push(s);
      }
    }
    return out.length === 1 && out[0].length === 1 ? out[0][0] : mat(out);
  }

  function dot(a, b) {
    if (isVec(a) && isVec(b)) {
      const x = vecList(a), y = vecList(b);
      if (x.length !== y.length) throw new MErr('내적: 두 벡터의 길이가 같아야 합니다');
      return x.reduce((s, v, i) => s + v * y[i], 0);
    }
    return mul(a, b);
  }

  function cross(a, b) {
    if (isVec(a) && isVec(b)) {
      const x = vecList(a), y = vecList(b);
      if (x.length !== 3 || y.length !== 3) throw new MErr('외적은 3차원 벡터끼리만 가능합니다');
      return mat([[x[1] * y[2] - x[2] * y[1]], [x[2] * y[0] - x[0] * y[2]], [x[0] * y[1] - x[1] * y[0]]]);
    }
    return mul(a, b);
  }

  function det(A) {
    if (!isMat(A)) return A;
    const [r, c] = dims(A);
    if (r !== c) throw new MErr('행렬식은 정사각행렬만 가능합니다');
    const m = A.m.map((row) => row.slice());
    let d = 1;
    for (let i = 0; i < r; i++) {
      let p = i;
      for (let k = i + 1; k < r; k++) if (Math.abs(m[k][i]) > Math.abs(m[p][i])) p = k;
      if (Math.abs(m[p][i]) < 1e-300) return 0;
      if (p !== i) { [m[p], m[i]] = [m[i], m[p]]; d = -d; }
      d *= m[i][i];
      for (let k = i + 1; k < r; k++) {
        const f = m[k][i] / m[i][i];
        for (let j = i; j < r; j++) m[k][j] -= f * m[i][j];
      }
    }
    return d;
  }

  function inv(A) {
    const [r, c] = dims(A);
    if (r !== c) throw new MErr('역행렬은 정사각행렬만 가능합니다');
    const m = A.m.map((row, i) => row.concat(row.map((_, j) => (i === j ? 1 : 0))));
    const scale = Math.max(...A.m.flat().map(Math.abs), 1e-300);
    for (let i = 0; i < r; i++) {
      let p = i;
      for (let k = i + 1; k < r; k++) if (Math.abs(m[k][i]) > Math.abs(m[p][i])) p = k;
      if (Math.abs(m[p][i]) < 1e-12 * scale) throw new MErr('역행렬이 없습니다 (행렬식 = 0)');
      [m[p], m[i]] = [m[i], m[p]];
      const piv = m[i][i];
      for (let j = 0; j < 2 * r; j++) m[i][j] /= piv;
      for (let k = 0; k < r; k++) {
        if (k === i) continue;
        const f = m[k][i];
        for (let j = 0; j < 2 * r; j++) m[k][j] -= f * m[i][j];
      }
    }
    return mat(m.map((row) => row.slice(r)));
  }

  function div(a, b) {
    if (!isMat(b)) {
      if (b === 0) throw new MErr('0으로 나눌 수 없습니다');
      return isMat(a) ? mul(a, 1 / b) : a / b;
    }
    return mul(a, inv(b));
  }

  function pow(a, b) {
    if (isMat(b)) throw new MErr('지수에 행렬을 쓸 수 없습니다');
    if (isMat(a)) {
      if (!Number.isInteger(b)) throw new MErr('행렬의 거듭제곱은 정수 지수만 가능합니다');
      const [r, c] = dims(a);
      if (r !== c) throw new MErr('정사각행렬만 거듭제곱할 수 있습니다');
      let base = b < 0 ? inv(a) : a;
      let e = Math.abs(b);
      let res = mat(a.m.map((row, i) => row.map((_, j) => (i === j ? 1 : 0))));
      while (e > 0) {
        if (e & 1) res = mulSq(res, base);
        base = mulSq(base, base);
        e >>= 1;
      }
      return res;
    }
    if (a === 0 && b < 0) throw new MErr('0으로 나눌 수 없습니다');
    if (a < 0 && !Number.isInteger(b)) {
      const q = 1 / b;
      if (Math.abs(q - Math.round(q)) < 1e-9 && Math.round(q) % 2 !== 0) return -Math.pow(-a, b);
      throw new MErr('음수의 분수 거듭제곱은 실수가 아닙니다');
    }
    return Math.pow(a, b);
  }
  function mulSq(a, b) { const r = mul(a, b); return isMat(r) ? r : mat([[r]]); }

  function transpose(A) {
    if (!isMat(A)) return A;
    const [r, c] = dims(A);
    const out = [];
    for (let j = 0; j < c; j++) { out.push([]); for (let i = 0; i < r; i++) out[j].push(A.m[i][j]); }
    return mat(out);
  }

  function gamma(x) {
    if (x < 0.5) return Math.PI / (Math.sin(Math.PI * x) * gamma(1 - x));
    const g = 7;
    const c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
      -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
    x -= 1;
    let s = c[0];
    for (let i = 1; i < g + 2; i++) s += c[i] / (x + i);
    const t = x + g + 0.5;
    return Math.sqrt(2 * Math.PI) * Math.pow(t, x + 0.5) * Math.exp(-t) * s;
  }

  function factorial(x) {
    if (isMat(x)) throw new MErr('행렬에는 팩토리얼을 쓸 수 없습니다');
    if (Number.isInteger(x)) {
      if (x < 0) throw new MErr('음수의 팩토리얼은 정의되지 않습니다');
      if (x > 170) return Infinity;
      let r = 1;
      for (let i = 2; i <= x; i++) r *= i;
      return r;
    }
    return gamma(x + 1);
  }

  const gcd2 = (a, b) => { a = Math.abs(a); b = Math.abs(b); while (b) [a, b] = [b, a % b]; return a; };
  const needInt = (x, name) => {
    if (isMat(x) || !Number.isInteger(Math.round(x * 1e9) / 1e9)) throw new MErr(`${name}: 정수가 필요합니다`);
    return Math.round(x);
  };

  // ------------------------------------------------------------------
  // 평가
  // ------------------------------------------------------------------
  function makeEnv(angle = 'RAD') { return { vars: {}, funcs: {}, angle, depth: 0 }; }

  function scalar(v, what) {
    if (isMat(v)) throw new MErr(`${what}: 숫자가 필요합니다 (행렬이 들어왔습니다)`);
    return v;
  }

  function lookup(name, env, scope) {
    if (scope && Object.prototype.hasOwnProperty.call(scope, name)) return scope[name];
    if (Object.prototype.hasOwnProperty.call(env.vars, name)) return env.vars[name];
    if (name === 'e') return Math.E;
    if (name === 'i') throw new MErr('복소수(i)는 지원하지 않습니다', 'unsupported');
    throw new MErr(`${name}의 값이 정해지지 않았습니다`, 'free');
  }

  function callFunc(f, args, env, node, scope) {
    const one = (what) => {
      if (args.length !== 1) throw new MErr(`${what}: 인수가 하나여야 합니다`);
      return args[0];
    };
    const toRad = (x) => (env.angle === 'DEG' ? (x * Math.PI) / 180 : x);
    const fromRad = (x) => (env.angle === 'DEG' ? (x * 180) / Math.PI : x);
    const clean = (v) => (Math.abs(v) < 1e-15 ? 0 : v);
    switch (f) {
      case 'sin': return clean(Math.sin(toRad(scalar(one(f), f))));
      case 'cos': return clean(Math.cos(toRad(scalar(one(f), f))));
      case 'tan': {
        const r = toRad(scalar(one(f), f));
        if (Math.abs(Math.cos(r)) < 1e-14) throw new MErr('tan: 정의되지 않는 각도입니다');
        return clean(Math.tan(r));
      }
      case 'cot': { const r = toRad(scalar(one(f), f)); const s = Math.sin(r); if (Math.abs(s) < 1e-14) throw new MErr('cot: 정의되지 않는 각도입니다'); return clean(Math.cos(r) / s); }
      case 'sec': { const c = Math.cos(toRad(scalar(one(f), f))); if (Math.abs(c) < 1e-14) throw new MErr('sec: 정의되지 않는 각도입니다'); return 1 / c; }
      case 'csc': { const s = Math.sin(toRad(scalar(one(f), f))); if (Math.abs(s) < 1e-14) throw new MErr('csc: 정의되지 않는 각도입니다'); return 1 / s; }
      case 'arcsin': case 'arccos': {
        const x = scalar(one(f), f);
        if (x < -1 - 1e-12 || x > 1 + 1e-12) throw new MErr(`${f}: 정의역은 -1 ~ 1 입니다`);
        const c = Math.max(-1, Math.min(1, x));
        return fromRad(f === 'arcsin' ? Math.asin(c) : Math.acos(c));
      }
      case 'arctan': return fromRad(Math.atan(scalar(one(f), f)));
      case 'sinh': return Math.sinh(scalar(one(f), f));
      case 'cosh': return Math.cosh(scalar(one(f), f));
      case 'tanh': return Math.tanh(scalar(one(f), f));
      case 'coth': return 1 / Math.tanh(scalar(one(f), f));
      case 'arsinh': return Math.asinh(scalar(one(f), f));
      case 'arcosh': return Math.acosh(scalar(one(f), f));
      case 'artanh': return Math.atanh(scalar(one(f), f));
      case 'ln': case 'log': case 'lg': {
        const x = scalar(one(f), f);
        if (x <= 0) throw new MErr('로그: 진수는 양수여야 합니다');
        if (f === 'ln') return Math.log(x);
        if (node && node.base) {
          const b = scalar(evaluate(node.base, env, scope), 'log 밑');
          if (b <= 0 || b === 1) throw new MErr('로그: 밑이 올바르지 않습니다');
          return Math.log(x) / Math.log(b);
        }
        return Math.log10(x);
      }
      case 'exp': return Math.exp(scalar(one(f), f));
      case 'sqrt': {
        const x = scalar(one(f), '√');
        if (x < 0) throw new MErr('음수의 제곱근은 실수가 아닙니다');
        return Math.sqrt(x);
      }
      case 'abs': {
        const x = one(f);
        if (isMat(x)) return isVec(x) ? Math.hypot(...vecList(x)) : det(x);
        return Math.abs(x);
      }
      case 'det': return det(one(f));
      case 'tr': { const A = one(f); if (!isMat(A)) return A; return A.m.reduce((s, r, i) => s + (r[i] ?? 0), 0); }
      case 'floor': return Math.floor(scalar(one(f), f));
      case 'ceil': return Math.ceil(scalar(one(f), f));
      case 'round': return Math.round(scalar(one(f), f));
      case 'sgn': return Math.sign(scalar(one(f), f));
      case 'max': return Math.max(...args.map((a) => scalar(a, f)));
      case 'min': return Math.min(...args.map((a) => scalar(a, f)));
      case 'gcd': return args.map((a) => needInt(a, 'gcd')).reduce(gcd2);
      case 'lcm': return args.map((a) => needInt(a, 'lcm')).reduce((a, b) => (a * b) / gcd2(a, b));
      case 'nCr': {
        const n = needInt(args[0], 'nCr'), r = needInt(args[1], 'nCr');
        if (r < 0 || r > n) return 0;
        let res = 1;
        for (let i = 1; i <= Math.min(r, n - r); i++) res = (res * (n - Math.min(r, n - r) + i)) / i;
        return Math.round(res);
      }
      default: throw new MErr(`${f}: 알 수 없는 함수입니다`, 'unsupported');
    }
  }

  function callUser(name, argVals, env, primes = 0) {
    const fn = env.funcs[name];
    if (env.depth > 60) throw new MErr('함수 호출이 너무 깊습니다 (재귀?)');
    if (argVals.length !== 1) throw new MErr(`${name}: 인수가 하나여야 합니다`);
    let body = fn.body;
    if (primes) {
      body = diffN(body, fn.param, primes, env);
    }
    env.depth++;
    try {
      return evaluate(body, env, { [fn.param]: argVals[0] });
    } finally { env.depth--; }
  }

  function evaluate(n, env, scope) {
    const ev = (x) => evaluate(x, env, scope);
    switch (n.t) {
      case 'num': return n.v;
      case 'const': return Math.PI;
      case 'var': return lookup(n.name, env, scope);
      case 'group': return ev(n.a);
      case 'neg': { const a = ev(n.a); return isMat(a) ? mul(a, -1) : -a; }
      case 'add': return add(ev(n.a), ev(n.b), 1);
      case 'sub': return add(ev(n.a), ev(n.b), -1);
      case 'mul': return mul(ev(n.a), ev(n.b));
      case 'dot': return dot(ev(n.a), ev(n.b));
      case 'cross': return cross(ev(n.a), ev(n.b));
      case 'div': return div(ev(n.a), ev(n.b));
      case 'pow': {
        const a = ev(n.a);
        const b = ev(n.b);
        return chkNum(pow(a, b));
      }
      case 'root': {
        const a = scalar(ev(n.a), '√'), k = scalar(ev(n.n), '√');
        if (k === 0) throw new MErr('0제곱근은 정의되지 않습니다');
        if (a < 0) {
          if (Number.isInteger(k) && Math.abs(k) % 2 === 1) return -Math.pow(-a, 1 / k);
          throw new MErr('음수의 짝수 제곱근은 실수가 아닙니다');
        }
        return Math.pow(a, 1 / k);
      }
      case 'fact': return factorial(ev(n.a));
      case 'deg': { const a = scalar(ev(n.a), '°'); return env.angle === 'DEG' ? a : (a * Math.PI) / 180; }
      case 'pct': return mul(ev(n.a), 0.01);
      case 'abs': return callFunc('abs', [ev(n.a)], env, n, scope);
      case 'transpose': return transpose(ev(n.a));
      case 'pm': throw new MErr('± 는 계산하지 않습니다 (두 경우로 나눠 입력해 주세요)', 'unsupported');
      case 'call': return chkNum(callFunc(n.f, n.args.map(ev), env, n, scope));
      case 'apply': {
        if (env.funcs[n.name] && !(scope && n.name in scope)) return callUser(n.name, n.args.map(ev), env, n.primes);
        if (n.primes) throw new MErr(`함수 ${n.name}가 정의되지 않았습니다 (예: ${n.name}(x)=x^2)`, 'free');
        const left = lookup(n.name, env, scope);
        const vals = n.args.map(ev);
        if (vals.length !== 1) throw new MErr(`${n.name}: 함수가 정의되지 않았습니다`, 'free');
        return mul(left, vals[0]);
      }
      case 'matrix': return mat(n.rows.map((r) => r.map((c) => scalar(ev(c), '행렬 원소'))));
      case 'int': {
        if (n.lo === null) throw new MErr('부정적분은 기호 계산이 필요합니다', 'symbolic');
        const lo = scalar(ev(n.lo), '적분 구간'), hi = scalar(ev(n.hi), '적분 구간');
        const f = (x) => {
          try {
            const v = evaluate(n.a, env, { ...scope, [n.v]: x });
            return isMat(v) ? NaN : v;
          } catch (e) {
            if (e instanceof MErr && (e.code === 'free' || e.code === 'unsupported' || e.code === 'symbolic')) throw e;
            return NaN;
          }
        };
        return integrate(f, lo, hi);
      }
      case 'sum': case 'prod': return bigOp(n, env, scope);
      case 'lim': return limit(n, env, scope).value;
      case 'deriv': {
        let d;
        try { d = diffN(n.a, n.v, n.n, env); } catch (e) { d = null; }
        if (d) return ev(d);
        const x0 = scalar(lookup(n.v, env, scope), '미분');
        if (n.n !== 1) throw new MErr('이 식의 고계 도함수는 계산할 수 없습니다');
        const h = 1e-5 * Math.max(1, Math.abs(x0));
        const g = (x) => scalar(evaluate(n.a, env, { ...scope, [n.v]: x }), '미분');
        return (g(x0 + h) - g(x0 - h)) / (2 * h);
      }
      case 'cmp': throw new MErr('등호/부등호가 식 중간에 있습니다');
      case 'system': throw new MErr('여러 식이 섞여 있습니다');
      default: throw new MErr('계산할 수 없는 식입니다', 'unsupported');
    }
  }

  // ------------------------------------------------------------------
  // 수치 해석: 적분, 합, 극한
  // ------------------------------------------------------------------
  function tanhSinh(f, a, b) {
    const r = (b - a) / 2;
    const at = (t) => {
      const u = (Math.PI / 2) * Math.sinh(t);
      const cu = Math.cosh(u);
      const w = ((Math.PI / 2) * Math.cosh(t)) / (cu * cu);
      if (!(w > 1e-300)) return 0;
      const d = (r * 2) / (Math.exp(2 * Math.abs(u)) + 1);
      const x = t >= 0 ? b - d : a + d;
      if (!(x > a && x < b)) return 0;
      const v = f(x);
      if (!Number.isFinite(v)) {
        if (w < 1e-25) return 0;
        return NaN;
      }
      return w * v;
    };
    const tmax = 4;
    let h = 1;
    let sum = 0;
    for (let j = -tmax; j <= tmax; j++) sum += at(j);
    let I = r * h * sum;
    let prev = I;
    for (let k = 1; k <= 9; k++) {
      h /= 2;
      for (let t = h; t <= tmax; t += 2 * h) sum += at(t) + at(-t);
      I = r * h * sum;
      if (Number.isNaN(I)) throw new MErr('적분 구간 안에 정의되지 않는 점이 있습니다');
      if (k >= 4 && Math.abs(I - prev) <= 1e-11 * Math.max(1, Math.abs(I))) return I;
      prev = I;
    }
    if (Math.abs(I - prev) > 1e-6 * Math.max(1, Math.abs(I))) throw new MErr('적분이 수렴하지 않습니다');
    return I;
  }

  function integrate(f, a, b) {
    if (a === b) return 0;
    if (a > b) return -integrate(f, b, a);
    if (a === -Infinity && b === Infinity) {
      return tanhSinh((t) => f(t / (1 - t * t)) * (1 + t * t) / ((1 - t * t) ** 2), -1, 1);
    }
    if (b === Infinity) return tanhSinh((t) => f(a + t / (1 - t)) / ((1 - t) ** 2), 0, 1);
    if (a === -Infinity) return tanhSinh((t) => f(b - t / (1 - t)) / ((1 - t) ** 2), 0, 1);
    return tanhSinh(f, a, b);
  }

  function bigOp(n, env, scope) {
    const isSum = n.t === 'sum';
    const lo = needInt(scalar(evaluate(n.lo, env, scope), '범위'), '범위');
    const hiRaw = scalar(evaluate(n.hi, env, scope), '범위');
    const term = (k) => evaluate(n.a, env, { ...scope, [n.v]: k });
    if (hiRaw === Infinity) {
      if (!isSum) throw new MErr('무한곱은 계산하지 않습니다');
      let s = 0;
      const N = 100000;
      let small = 0;
      let k = lo;
      for (; k <= lo + N; k++) {
        const t = scalar(term(k), '합');
        if (!Number.isFinite(t)) throw new MErr('급수의 항이 정의되지 않습니다');
        s += t;
        if (Math.abs(t) <= 1e-17 * Math.max(1e-300, Math.abs(s))) { if (++small > 20) return s; } else small = 0;
      }
      // 꼬리 추정: 항이 k^-p 꼴이라고 보고 적분 판정
      const t1 = Math.abs(scalar(term(k), '합')), t0 = Math.abs(scalar(term(Math.round(k / 10)), '합'));
      if (t1 === 0) return s;
      const p = Math.log(t0 / t1) / Math.log(10);
      if (!(p > 1.05)) throw new MErr(p > 0.95 ? '급수가 발산합니다' : '급수가 수렴하지 않습니다');
      const sign = Math.sign(scalar(term(k), '합'));
      const alt = Math.sign(scalar(term(k + 1), '합')) !== sign;
      return alt ? s : s + (sign * t1 * k) / (p - 1);
    }
    const hi = needInt(hiRaw, '범위');
    if (hi - lo > 5e6) throw new MErr('항이 너무 많습니다 (500만 개 초과)');
    let acc = isSum ? 0 : 1;
    for (let k = lo; k <= hi; k++) {
      const t = term(k);
      acc = isSum ? add(acc, t) : mul(acc, t);
    }
    return acc;
  }

  function richardson(g) {
    // g(h): h→0+ 에서의 극한을 h = 0.1·2^-k 점들로 외삽
    const R = [];
    let best = null, bestErr = Infinity;
    for (let k = 0; k <= 12; k++) {
      const h = 0.1 * 2 ** -k;
      const row = [g(h)];
      for (let j = 1; j <= k && j <= 6; j++) {
        row.push(row[j - 1] + (row[j - 1] - R[k - 1][j - 1]) / (2 ** j - 1));
      }
      R.push(row);
      if (k >= 2) {
        const cur = row[row.length - 1];
        const prev = R[k - 1][R[k - 1].length - 1];
        const err = Math.abs(cur - prev);
        if (Number.isFinite(cur) && err < bestErr) { bestErr = err; best = cur; }
      }
    }
    const raw = R.map((r) => r[0]);
    return { value: best, err: bestErr, raw };
  }

  function limit(n, env, scope) {
    const to = scalar(evaluate(n.to, env, scope), '극한');
    const f = (x) => {
      try { const v = evaluate(n.a, env, { ...scope, [n.v]: x }); return isMat(v) ? NaN : v; } catch (e) {
        if (e instanceof MErr && (e.code === 'free' || e.code === 'unsupported')) throw e;
        return NaN;
      }
    };
    const side = (dir) => {
      let g;
      if (to === Infinity) g = (h) => f(1 / (h * h * 1e3));
      else if (to === -Infinity) g = (h) => f(-1 / (h * h * 1e3));
      else g = (h) => f(to + dir * h * Math.max(1, Math.abs(to)));
      const res = richardson(g);
      const raw = res.raw.filter(Number.isFinite);
      if (raw.length >= 6) {
        const last = raw.slice(-5);
        const growing = last.every((v, i) => i === 0 || Math.abs(v) > Math.abs(last[i - 1]) * 1.3);
        if (growing && Math.abs(last[4]) > 1e3) return { inf: Math.sign(last[4]) };
      }
      if (res.value === null || !Number.isFinite(res.value)) return { fail: true };
      const scale = Math.max(1, Math.abs(res.value));
      if (res.err > 1e-4 * scale) return { fail: true };
      return { v: res.value, err: res.err };
    };
    const show = (s) => (s.inf ? (s.inf > 0 ? Infinity : -Infinity) : s.v);
    if (to === Infinity || to === -Infinity || n.side) {
      const s = side(n.side === '-' ? -1 : 1);
      if (s.fail) throw new MErr('극한값을 찾지 못했습니다 (진동하거나 수렴하지 않을 수 있음)');
      return { value: show(s), approx: true };
    }
    const L = side(-1), Rr = side(1);
    if (L.fail || Rr.fail) throw new MErr('극한값을 찾지 못했습니다 (진동하거나 수렴하지 않을 수 있음)');
    const lv = show(L), rv = show(Rr);
    if (lv === rv) return { value: lv };
    if (Number.isFinite(lv) && Number.isFinite(rv) && Math.abs(lv - rv) <= 1e-6 * Math.max(1, Math.abs(lv))) {
      return { value: (lv + rv) / 2 };
    }
    throw new MErr(`좌극한(${fmtPlain(lv)})과 우극한(${fmtPlain(rv)})이 달라 극한이 존재하지 않습니다`);
  }

  // ------------------------------------------------------------------
  // 기호 미분 & 단순화 & LaTeX 출력
  // ------------------------------------------------------------------
  const N = (v) => ({ t: 'num', v });
  const isNum = (n, v) => n.t === 'num' && (v === undefined || n.v === v);
  const C = (f, a) => ({ t: 'call', f, args: [a] });
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

  function children(n) {
    const out = [];
    for (const k of ['a', 'b', 'n', 'lo', 'hi', 'to', 'base']) if (n[k] && typeof n[k] === 'object') out.push(n[k]);
    if (n.args) out.push(...n.args);
    if (n.rows) n.rows.forEach((r) => out.push(...r));
    if (n.items) out.push(...n.items);
    if (n.parts) out.push(...n.parts);
    return out;
  }

  function freeVars(n, env, bound = new Set(), out = new Set(), seenFuncs = new Set()) {
    if (n.t === 'var') {
      if (!bound.has(n.name) && !(n.name in env.vars) && n.name !== 'e') out.add(n.name);
      return out;
    }
    if (n.t === 'apply') {
      if (env.funcs[n.name] && !bound.has(n.name)) {
        if (!seenFuncs.has(n.name)) {
          seenFuncs.add(n.name);
          const fn = env.funcs[n.name];
          freeVars(fn.body, env, new Set([...bound, fn.param]), out, seenFuncs);
        }
      } else if (!bound.has(n.name) && !(n.name in env.vars) && n.name !== 'e') out.add(n.name);
      n.args.forEach((a) => freeVars(a, env, bound, out, seenFuncs));
      return out;
    }
    if (n.t === 'int' || n.t === 'sum' || n.t === 'prod' || n.t === 'lim') {
      for (const k of ['lo', 'hi', 'to']) if (n[k]) freeVars(n[k], env, bound, out, seenFuncs);
      freeVars(n.a, env, new Set([...bound, n.v]), out, seenFuncs);
      return out;
    }
    children(n).forEach((c) => freeVars(c, env, bound, out, seenFuncs));
    return out;
  }

  function dependsOn(n, v, env) {
    return freeVars(n, { ...env, vars: Object.fromEntries(Object.entries(env.vars).filter(([k]) => k !== v)) }).has(v);
  }

  function diff(n, v, env) {
    const d = (x) => diff(x, v, env);
    if (!dependsOn(n, v, env)) return N(0);
    switch (n.t) {
      case 'var': return N(n.name === v ? 1 : 0);
      case 'group': return d(n.a);
      case 'neg': return { t: 'neg', a: d(n.a) };
      case 'add': return { t: 'add', a: d(n.a), b: d(n.b) };
      case 'sub': return { t: 'sub', a: d(n.a), b: d(n.b) };
      case 'mul': case 'dot': case 'cross':
        return { t: 'add', a: { t: 'mul', a: d(n.a), b: n.b }, b: { t: 'mul', a: n.a, b: d(n.b) } };
      case 'div':
        if (!dependsOn(n.b, v, env)) return { t: 'div', a: d(n.a), b: n.b };
        return { t: 'div', a: { t: 'sub', a: { t: 'mul', a: d(n.a), b: n.b }, b: { t: 'mul', a: n.a, b: d(n.b) } }, b: { t: 'pow', a: n.b, b: N(2) } };
      case 'pow': {
        const A = n.a, B = n.b;
        if (!dependsOn(B, v, env)) {
          return { t: 'mul', a: { t: 'mul', a: B, b: { t: 'pow', a: A, b: { t: 'sub', a: B, b: N(1) } } }, b: d(A) };
        }
        if (!dependsOn(A, v, env)) {
          const lnA = A.t === 'var' && A.name === 'e' && !('e' in env.vars) ? N(1) : C('ln', A);
          return { t: 'mul', a: { t: 'mul', a: n, b: lnA }, b: d(B) };
        }
        return { t: 'mul', a: n, b: { t: 'add', a: { t: 'mul', a: d(B), b: C('ln', A) }, b: { t: 'div', a: { t: 'mul', a: B, b: d(A) }, b: A } } };
      }
      case 'root': return d({ t: 'pow', a: n.a, b: { t: 'div', a: N(1), b: n.n } });
      case 'abs': return { t: 'mul', a: { t: 'div', a: n.a, b: { t: 'abs', a: n.a } }, b: d(n.a) };
      case 'pct': return { t: 'div', a: d(n.a), b: N(100) };
      case 'deriv': return d(diffN(n.a, n.v, n.n, env));
      case 'apply': {
        if (env.funcs[n.name]) {
          const fn = env.funcs[n.name];
          let body = fn.body;
          if (n.primes) body = diffN(body, fn.param, n.primes, env);
          return d(substitute(body, fn.param, n.args[0]));
        }
        return d({ t: 'mul', a: { t: 'var', name: n.name }, b: n.args[0] });
      }
      case 'call': {
        if (n.args.length !== 1) throw new MErr('미분할 수 없는 함수입니다');
        const u = n.args[0];
        const du = d(u);
        let fp;
        switch (n.f) {
          case 'sin': fp = C('cos', u); break;
          case 'cos': fp = { t: 'neg', a: C('sin', u) }; break;
          case 'tan': fp = { t: 'pow', a: C('sec', u), b: N(2) }; break;
          case 'cot': fp = { t: 'neg', a: { t: 'pow', a: C('csc', u), b: N(2) } }; break;
          case 'sec': fp = { t: 'mul', a: C('sec', u), b: C('tan', u) }; break;
          case 'csc': fp = { t: 'neg', a: { t: 'mul', a: C('csc', u), b: C('cot', u) } }; break;
          case 'arcsin': fp = { t: 'div', a: N(1), b: C('sqrt', { t: 'sub', a: N(1), b: { t: 'pow', a: u, b: N(2) } }) }; break;
          case 'arccos': fp = { t: 'neg', a: { t: 'div', a: N(1), b: C('sqrt', { t: 'sub', a: N(1), b: { t: 'pow', a: u, b: N(2) } }) } }; break;
          case 'arctan': fp = { t: 'div', a: N(1), b: { t: 'add', a: N(1), b: { t: 'pow', a: u, b: N(2) } } }; break;
          case 'sinh': fp = C('cosh', u); break;
          case 'cosh': fp = C('sinh', u); break;
          case 'tanh': fp = { t: 'div', a: N(1), b: { t: 'pow', a: C('cosh', u), b: N(2) } }; break;
          case 'ln': fp = { t: 'div', a: N(1), b: u }; break;
          case 'log': case 'lg': {
            const base = n.base || N(10);
            fp = { t: 'div', a: N(1), b: { t: 'mul', a: u, b: C('ln', base) } };
            break;
          }
          case 'exp': fp = C('exp', u); break;
          case 'sqrt': fp = { t: 'div', a: N(1), b: { t: 'mul', a: N(2), b: C('sqrt', u) } }; break;
          case 'abs': fp = { t: 'div', a: u, b: { t: 'abs', a: u } }; break;
          default: throw new MErr(`${n.f}는 미분할 수 없습니다`);
        }
        return { t: 'mul', a: fp, b: du };
      }
      default: throw new MErr('이 식은 기호 미분할 수 없습니다');
    }
  }

  function diffN(n, v, k, env) {
    let r = n;
    for (let i = 0; i < k; i++) r = simplify(diff(r, v, env));
    return r;
  }

  function substitute(n, name, rep) {
    if (n.t === 'var' && n.name === name) return rep;
    if (['int', 'sum', 'prod', 'lim'].includes(n.t) && n.v === name) {
      const c = { ...n };
      for (const k of ['lo', 'hi', 'to']) if (n[k]) c[k] = substitute(n[k], name, rep);
      return c;
    }
    const c = { ...n };
    for (const k of ['a', 'b', 'n', 'lo', 'hi', 'to', 'base']) if (n[k] && typeof n[k] === 'object') c[k] = substitute(n[k], name, rep);
    if (n.args) c.args = n.args.map((x) => substitute(x, name, rep));
    if (n.rows) c.rows = n.rows.map((r) => r.map((x) => substitute(x, name, rep)));
    return c;
  }

  // 수치 계수 분리: 3·x → [3, x]
  function coef(n) {
    if (n.t === 'num') return [n.v, null];
    if (n.t === 'neg') { const [c, r] = coef(n.a); return [-c, r]; }
    if (n.t === 'mul' && n.a.t === 'num') return [n.a.v, n.b];
    return [1, n];
  }
  const withCoef = (c, r) => {
    if (r === null) return N(c);
    if (c === 0) return N(0);
    if (c === 1) return r;
    if (c === -1) return { t: 'neg', a: r };
    return { t: 'mul', a: N(c), b: r };
  };

  function simplify(n) {
    const s = simplify;
    switch (n.t) {
      case 'group': return s(n.a);
      case 'neg': {
        const a = s(n.a);
        if (a.t === 'num') return N(-a.v);
        if (a.t === 'neg') return a.a;
        if (a.t === 'mul' && a.a.t === 'num') return withCoef(-a.a.v, a.b);
        return { t: 'neg', a };
      }
      case 'add': case 'sub': {
        const a = s(n.a);
        let b = s(n.b);
        const sign = n.t === 'add' ? 1 : -1;
        if (a.t === 'num' && b.t === 'num') return N(a.v + sign * b.v);
        if (isNum(b, 0)) return a;
        if (isNum(a, 0)) return sign === 1 ? b : s({ t: 'neg', a: b });
        const [ca, ra] = coef(a), [cb, rb] = coef(b);
        if (ra && rb && same(ra, rb)) return s(withCoef(ca + sign * cb, ra));
        if (b.t === 'neg') return { t: sign === 1 ? 'sub' : 'add', a, b: b.a };
        if (b.t === 'num' && b.v < 0) return { t: sign === 1 ? 'sub' : 'add', a, b: N(-b.v) };
        if (b.t === 'mul' && b.a.t === 'num' && b.a.v < 0) return { t: sign === 1 ? 'sub' : 'add', a, b: withCoef(-b.a.v, b.b) };
        return { t: n.t, a, b };
      }
      case 'mul': case 'dot': case 'cross': {
        let a = s(n.a), b = s(n.b);
        if (a.t === 'num' && b.t === 'num') return N(a.v * b.v);
        if (isNum(a, 0) || isNum(b, 0)) return N(0);
        if (isNum(a, 1)) return b;
        if (isNum(b, 1)) return a;
        if (b.t === 'num') [a, b] = [b, a];
        if (a.t === 'neg') return s({ t: 'neg', a: { t: 'mul', a: a.a, b } });
        if (b.t === 'neg') return s({ t: 'neg', a: { t: 'mul', a, b: b.a } });
        if (a.t === 'num' && b.t === 'mul' && b.a.t === 'num') return s({ t: 'mul', a: N(a.v * b.a.v), b: b.b });
        if (a.t !== 'num' && b.t === 'mul' && b.a.t === 'num') return s({ t: 'mul', a: b.a, b: { t: 'mul', a, b: b.b } });
        if (a.t === 'mul' && a.a.t === 'num' && b.t !== 'num') return s({ t: 'mul', a: a.a, b: { t: 'mul', a: a.b, b } });
        if (a.t === 'num' && b.t === 'div' && b.a.t === 'num') return s({ t: 'div', a: N(a.v * b.a.v), b: b.b });
        if (b.t === 'div' && isNum(b.a, 1)) return s({ t: 'div', a, b: b.b });
        if (a.t === 'div' && isNum(a.a, 1)) return s({ t: 'div', a: b, b: a.b });
        // x·x → x², x·x^n → x^(n+1)
        const base = (x) => (x.t === 'pow' && x.b.t === 'num' ? [x.a, x.b.v] : [x, 1]);
        const [ba, ea] = base(a), [bb, eb] = base(b);
        if (a.t !== 'num' && same(ba, bb)) return s({ t: 'pow', a: ba, b: N(ea + eb) });
        const rank = (x) => (x.t === 'num' ? 0 : x.t === 'var' || (x.t === 'pow' && x.a.t === 'var') ? 1 : 2);
        if (rank(a) > rank(b)) return s({ t: 'mul', a: b, b: a });
        return { t: 'mul', a, b };
      }
      case 'div': {
        const a = s(n.a), b = s(n.b);
        if (isNum(a, 0)) return N(0);
        if (isNum(b, 1)) return a;
        if (same(a, b)) return N(1);
        if (a.t === 'num' && b.t === 'num') {
          if (Number.isInteger(a.v) && Number.isInteger(b.v) && b.v !== 0) {
            const g = gcd2(a.v, b.v) * Math.sign(b.v);
            if (b.v / g === 1) return N(a.v / g);
            return { t: 'div', a: N(a.v / g), b: N(b.v / g) };
          }
          return N(a.v / b.v);
        }
        if (a.t === 'neg') return { t: 'neg', a: s({ t: 'div', a: a.a, b }) };
        if (b.t === 'num' && a.t === 'mul' && a.a.t === 'num' && Number.isInteger(a.a.v) && Number.isInteger(b.v)) {
          const g = gcd2(a.a.v, b.v);
          if (g > 1) return s({ t: 'div', a: withCoef(a.a.v / g, a.b), b: N(b.v / g) });
        }
        if (b.t === 'num' && a.t === 'mul' && a.a.t === 'num' && a.a.v % b.v === 0) return withCoef(a.a.v / b.v, a.b);
        return { t: 'div', a, b };
      }
      case 'pow': {
        const a = s(n.a), b = s(n.b);
        if (isNum(b, 0)) return N(1);
        if (isNum(b, 1)) return a;
        if (isNum(a, 1)) return N(1);
        if (a.t === 'num' && b.t === 'num' && Number.isInteger(b.v) && b.v >= 0) return N(a.v ** b.v);
        if (a.t === 'pow' && a.b.t === 'num' && b.t === 'num') return s({ t: 'pow', a: a.a, b: N(a.b.v * b.v) });
        return { t: 'pow', a, b };
      }
      case 'call': {
        const args = n.args.map(s);
        const r = { ...n, args };
        if (n.base) r.base = s(n.base);
        if (args.length === 1 && args[0].t === 'num') {
          const v = args[0].v;
          if (n.f === 'ln' && v === 1) return N(0);
          if ((n.f === 'sin' || n.f === 'tan' || n.f === 'sinh') && v === 0) return N(0);
          if ((n.f === 'cos' || n.f === 'cosh' || n.f === 'exp') && v === 0) return N(1);
          if (n.f === 'sqrt' && Number.isInteger(Math.sqrt(v))) return N(Math.sqrt(v));
        }
        return r;
      }
      default: {
        const c = { ...n };
        for (const k of ['a', 'b', 'n', 'base']) if (n[k] && typeof n[k] === 'object') c[k] = s(n[k]);
        if (n.args) c.args = n.args.map(s);
        if (n.rows) c.rows = n.rows.map((r) => r.map(s));
        return c;
      }
    }
  }

  function expandDerivs(n, env) {
    if (n.t === 'deriv') return diffN(expandDerivs(n.a, env), n.v, n.n, env);
    if (n.t === 'apply' && n.primes && env.funcs[n.name]) {
      const fn = env.funcs[n.name];
      return simplify(substitute(diffN(fn.body, fn.param, n.primes, env), fn.param, n.args[0]));
    }
    const c = { ...n };
    for (const k of ['a', 'b', 'n', 'lo', 'hi', 'to', 'base']) if (n[k] && typeof n[k] === 'object') c[k] = expandDerivs(n[k], env);
    if (n.args) c.args = n.args.map((x) => expandDerivs(x, env));
    if (n.rows) c.rows = n.rows.map((r) => r.map((x) => expandDerivs(x, env)));
    return c;
  }
  const hasDeriv = (n) => n.t === 'deriv' || (n.t === 'apply' && n.primes > 0) || children(n).some(hasDeriv);

  const FN_LATEX = {
    sin: '\\sin', cos: '\\cos', tan: '\\tan', cot: '\\cot', sec: '\\sec', csc: '\\csc',
    arcsin: '\\arcsin', arccos: '\\arccos', arctan: '\\arctan', sinh: '\\sinh', cosh: '\\cosh',
    tanh: '\\tanh', coth: '\\coth', ln: '\\ln', log: '\\log', lg: '\\lg', det: '\\det', max: '\\max',
    min: '\\min', gcd: '\\gcd', arsinh: '\\operatorname{arsinh}', arcosh: '\\operatorname{arcosh}',
    artanh: '\\operatorname{artanh}', tr: '\\operatorname{tr}', floor: '\\operatorname{floor}',
    ceil: '\\operatorname{ceil}', round: '\\operatorname{round}', sgn: '\\operatorname{sgn}',
    lcm: '\\operatorname{lcm}', nCr: '\\operatorname{C}',
  };

  function toLatex(n, prec = 0) {
    const L = toLatex;
    const wrap = (s, need) => (need ? `\\left(${s}\\right)` : s);
    switch (n.t) {
      case 'num': {
        if (n.v === Infinity) return '\\infty';
        if (n.v === -Infinity) return wrap('-\\infty', prec > 1);
        const s = numLatex(n.v, true);
        return wrap(s, (n.v < 0 && prec > 1) || (s.includes('frac') && prec >= 3));
      }
      case 'const': return '\\pi';
      case 'var': return n.name;
      case 'group': return L(n.a, prec);
      case 'add': return wrap(`${L(n.a, 1)}+${L(n.b, 1)}`, prec > 1);
      case 'sub': return wrap(`${L(n.a, 1)}-${L(n.b, 2)}`, prec > 1);
      case 'pm': return wrap(`${L(n.a, 1)}\\pm ${L(n.b, 2)}`, prec > 1);
      case 'neg': return wrap(`-${L(n.a, 2)}`, prec > 1);
      case 'mul': case 'dot': case 'cross': {
        const left = L(n.a, 2), right = L(n.b, 2.5);
        let op = '';
        if (n.t === 'cross') op = '\\times ';
        else if (n.t === 'dot') op = '\\cdot ';
        else if (n.b.t === 'num' || /^[0-9-]/.test(right) || (n.a.t === 'num' && n.b.t === 'div')) op = '\\cdot ';
        else if (/[a-zA-Z]$/.test(left) && /^[a-zA-Z]/.test(right)) op = ' ';
        return wrap(`${left}${op}${right}`, prec > 2.5);
      }
      case 'div': return wrap(`\\frac{${L(n.a)}}{${L(n.b)}}`, prec >= 3);
      case 'pow': {
        if (n.a.t === 'call' && n.a.args.length === 1 && FN_LATEX[n.a.f] && !n.a.base) {
          return `${FN_LATEX[n.a.f]}^{${L(n.b)}}\\left(${L(n.a.args[0])}\\right)`;
        }
        const atom = ['var', 'const'].includes(n.a.t) || (n.a.t === 'num' && n.a.v >= 0 && Number.isInteger(n.a.v)) ||
          n.a.t === 'matrix' || n.a.t === 'abs' || (n.a.t === 'call' && n.a.f === 'sqrt');
        const base = atom ? L(n.a, 4) : `\\left(${L(n.a)}\\right)`;
        return `${base}^{${L(n.b)}}`;
      }
      case 'root': return `\\sqrt[${L(n.n)}]{${L(n.a)}}`;
      case 'fact': return `${L(n.a, 4)}!`;
      case 'deg': return `${L(n.a, 4)}^{\\circ}`;
      case 'pct': return `${L(n.a, 4)}\\%`;
      case 'abs': return `\\left|${L(n.a)}\\right|`;
      case 'transpose': return `${L(n.a, 4)}^{T}`;
      case 'apply': return `${n.name}${"'".repeat(n.primes || 0)}\\left(${n.args.map((x) => L(x)).join(',')}\\right)`;
      case 'call': {
        if (n.f === 'sqrt') return `\\sqrt{${L(n.args[0])}}`;
        if (n.f === 'exp') return `e^{${L(n.args[0])}}`;
        if (n.f === 'abs') return `\\left|${L(n.args[0])}\\right|`;
        let name = FN_LATEX[n.f] || `\\operatorname{${n.f}}`;
        if (n.base) name += `_{${L(n.base)}}`;
        const s = `${name}\\left(${n.args.map((x) => L(x)).join(',')}\\right)`;
        return s;
      }
      case 'matrix':
        return `\\begin{pmatrix}${n.rows.map((r) => r.map((x) => L(x)).join('&')).join('\\\\')}\\end{pmatrix}`;
      case 'deriv': return `\\frac{d${n.n > 1 ? `^{${n.n}}` : ''}}{d${n.v}${n.n > 1 ? `^{${n.n}}` : ''}}\\left(${L(n.a)}\\right)`;
      default: throw new MErr('표시할 수 없는 식');
    }
  }

  // ------------------------------------------------------------------
  // 숫자 서식
  // ------------------------------------------------------------------
  function toFrac(x, maxDen, tol) {
    if (!Number.isFinite(x)) return null;
    let h1 = 1, h0 = 0, k1 = 0, k0 = 1, b = x;
    for (let i = 0; i < 40; i++) {
      const a = Math.floor(b);
      [h1, h0] = [a * h1 + h0, h1];
      [k1, k0] = [a * k1 + k0, k1];
      if (k1 > maxDen) return null;
      if (Math.abs(x - h1 / k1) <= tol * Math.max(1, Math.abs(x))) return [h1, k1];
      const frac = b - a;
      if (frac < 1e-15) break;
      b = 1 / frac;
    }
    return null;
  }

  function decimal(v, digits = 10) {
    if (v === 0) return '0';
    const av = Math.abs(v);
    if (av >= 1e-5 && av < 1e12) {
      let s = Number(v.toPrecision(digits)).toString();
      if (s.includes('e')) s = v.toFixed(12).replace(/0+$/, '').replace(/\.$/, '');
      return s;
    }
    const [m, e] = v.toExponential(digits - 1).split('e');
    const mm = m.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
    return `${mm}\\times10^{${Number(e)}}`;
  }

  // 정확한 꼴 찾기: 정수, 분수, π의 배수, 제곱근
  function exactLatex(v, tol = 1e-12) {
    if (!Number.isFinite(v)) return v > 0 ? '\\infty' : v < 0 ? '-\\infty' : null;
    const neg = v < 0 ? '-' : '';
    const a = Math.abs(v);
    if (Math.abs(a - Math.round(a)) <= tol * Math.max(1, a) && a < 1e15) return neg + String(Math.round(a));
    const fr = toFrac(a, 1000, tol);
    if (fr) return `${neg}\\frac{${fr[0]}}{${fr[1]}}`;
    const pf = toFrac(a / Math.PI, 24, tol);
    if (pf && pf[0] <= 100) {
      const top = pf[0] === 1 ? '\\pi' : `${pf[0]}\\pi`;
      return pf[1] === 1 ? neg + top : `${neg}\\frac{${top}}{${pf[1]}}`;
    }
    const sq = toFrac(a * a, 200, tol * 4);
    if (sq) {
      const [p, q] = sq;
      let prod = p * q, s = 1;
      if (prod <= 1e6) {
        for (let k = Math.floor(Math.sqrt(prod)); k > 1; k--) if (prod % (k * k) === 0) { s = k; prod /= k * k; break; }
        if (prod > 1) {
          const g = gcd2(s, q);
          const num = s / g, den = q / g;
          const top = `${num === 1 ? '' : num}\\sqrt{${prod}}`;
          return den === 1 ? neg + top : `${neg}\\frac{${top}}{${den}}`;
        }
      }
    }
    return null;
  }

  function numLatex(v, short = false, tol = 1e-12) {
    const ex = exactLatex(v, tol);
    if (ex) return ex;
    return decimal(v, short ? 8 : 10);
  }

  function fmtValue(v, opts = {}) {
    const tol = opts.tol ?? 1e-12;
    if (isMat(v)) {
      const cell = (x) => numLatex(x, true, Math.max(tol, 1e-10));
      return { latex: `\\begin{pmatrix}${v.m.map((r) => r.map(cell).join('&')).join('\\\\')}\\end{pmatrix}` };
    }
    if (!Number.isFinite(v)) return { latex: v > 0 ? '\\infty' : '-\\infty' };
    const ex = exactLatex(v, tol);
    const dec = decimal(v, opts.approx ? 8 : 10);
    if (ex && !/^-?\d+$/.test(ex)) return { latex: `${ex}\\approx ${dec}`, exact: ex, approx: dec };
    if (ex) return { latex: opts.approx ? `\\approx ${ex}` : ex, exact: ex };
    return { latex: `${opts.approx ? '\\approx ' : ''}${dec}`, approx: dec };
  }

  function fmtPlain(v) {
    if (!Number.isFinite(v)) return v > 0 ? '∞' : '-∞';
    return decimal(v).replace('\\times10^{', '×10^').replace('}', '');
  }

  // ------------------------------------------------------------------
  // 방정식 / 부등식 / 연립방정식
  // ------------------------------------------------------------------
  let GRID = null;
  function grid() {
    if (GRID) return GRID;
    const xs = [];
    for (let i = -2000; i <= 2000; i++) xs.push(i / 100);
    for (let k = 1; k <= 600; k++) { const v = 10 ** (1.30103 + k / 200); xs.push(v, -v); }
    GRID = xs.sort((a, b) => a - b);
    return GRID;
  }

  function snap(x, tol = 1e-9) {
    const cands = [Math.round(x)];
    const fr = toFrac(x, 100, tol);
    if (fr) cands.push(fr[0] / fr[1]);
    const pf = toFrac(x / Math.PI, 12, tol);
    if (pf) cands.push((pf[0] / pf[1]) * Math.PI);
    const sq = toFrac(x * x, 100, tol);
    if (sq) cands.push(Math.sign(x) * Math.sqrt(sq[0] / sq[1]));
    for (const c of cands) if (Math.abs(c - x) <= tol * Math.max(1, Math.abs(x))) return c;
    return x;
  }

  function findRoots(F) {
    const xs = grid();
    const safe = (x) => { try { const v = F(x); return typeof v === 'number' ? v : NaN; } catch { return NaN; } };
    const vs = xs.map(safe);
    const roots = [];
    for (let i = 0; i < xs.length; i++) {
      const v = vs[i];
      if (v === 0) roots.push(xs[i]);
      if (i + 1 < xs.length && Number.isFinite(v) && Number.isFinite(vs[i + 1]) && v * vs[i + 1] < 0) {
        let a = xs[i], b = xs[i + 1], fa = v;
        for (let k = 0; k < 200 && b - a > 1e-15 * Math.max(1, Math.abs(a)); k++) {
          const m = (a + b) / 2, fm = safe(m);
          if (!Number.isFinite(fm)) break;
          if (fm === 0) { a = b = m; break; }
          if (fa * fm < 0) b = m; else { a = m; fa = fm; }
        }
        const r = (a + b) / 2;
        const fr = safe(r);
        if (Number.isFinite(fr) && Math.abs(fr) <= 1e-7 * (1 + Math.abs(v) + Math.abs(vs[i + 1]))) roots.push(r);
      }
      // 접하는 근: |F|의 극소
      if (i > 0 && i + 1 < xs.length && [vs[i - 1], v, vs[i + 1]].every(Number.isFinite) &&
          Math.abs(v) < Math.abs(vs[i - 1]) && Math.abs(v) <= Math.abs(vs[i + 1]) && v !== 0 &&
          Math.sign(vs[i - 1]) === Math.sign(v) && Math.sign(vs[i + 1]) === Math.sign(v)) {
        let a = xs[i - 1], b = xs[i + 1];
        for (let k = 0; k < 120; k++) {
          const m1 = a + (b - a) * 0.382, m2 = a + (b - a) * 0.618;
          if (Math.abs(safe(m1)) < Math.abs(safe(m2))) b = m2; else a = m1;
        }
        const m = (a + b) / 2;
        if (Math.abs(safe(m)) < 1e-12 * Math.max(1, Math.abs(vs[i - 1]))) roots.push(m);
      }
    }
    roots.sort((a, b) => a - b);
    const out = [];
    for (const r of roots) {
      const s = snap(r, 1e-7);
      const best = Math.abs(safe(s)) <= Math.abs(safe(r)) * 10 + 1e-12 ? s : r;
      if (!out.length || Math.abs(best - out[out.length - 1]) > 1e-6 * Math.max(1, Math.abs(best))) out.push(best);
    }
    return out;
  }

  function cmpHolds(op, a, b, rel = 1e-10) {
    // rel이 아주 작을 때(부등식 풀이)는 순수 상대오차만 써서 x²≤0 같은 경계가 번지지 않게 한다
    const tol = rel * (rel < 1e-12 ? Math.max(Math.abs(a), Math.abs(b)) : Math.max(1, Math.abs(a), Math.abs(b)));
    switch (op) {
      case '=': case '≈': return Math.abs(a - b) <= tol;
      case '!=': return Math.abs(a - b) > tol;
      case '<': return a < b - tol;
      case '>': return a > b + tol;
      case '<=': return a <= b + tol;
      case '>=': return a >= b - tol;
      default: return false;
    }
  }

  function solveIneq(pred) {
    const xs = grid();
    const truth = xs.map(pred);
    const refine = (lo, hi, loTruth) => {
      for (let k = 0; k < 200 && hi - lo > 1e-15 * Math.max(1, Math.abs(lo)); k++) {
        const m = (lo + hi) / 2;
        if (pred(m) === loTruth) lo = m; else hi = m;
      }
      return snap((lo + hi) / 2, 1e-7);
    };
    const intervals = [];
    let i = 0;
    while (i < xs.length) {
      if (!truth[i]) { i++; continue; }
      let j = i;
      while (j + 1 < xs.length && truth[j + 1]) j++;
      const left = i === 0 ? -Infinity : refine(xs[i - 1], xs[i], false);
      const right = j === xs.length - 1 ? Infinity : refine(xs[j], xs[j + 1], true);
      intervals.push({ left, right, li: Number.isFinite(left) && pred(left), ri: Number.isFinite(right) && pred(right) });
      i = j + 1;
    }
    // 겹치는 경계 병합 (x ≠ a 같은 경우)
    const merged = [];
    for (const iv of intervals) {
      const last = merged[merged.length - 1];
      if (last && last.right === iv.left && (last.ri || iv.li)) { last.right = iv.right; last.ri = iv.ri; }
      else merged.push({ ...iv });
    }
    return merged;
  }

  function intervalsLatex(ivs, x) {
    if (!ivs.length) return '\\text{해 없음}';
    if (ivs.length === 1 && ivs[0].left === -Infinity && ivs[0].right === Infinity) return '\\text{모든 실수}';
    const n = (v) => numLatex(v, true, 1e-8);
    const parts = ivs.map(({ left, right, li, ri }) => {
      if (left === right) return `${x}=${n(left)}`;
      if (left === -Infinity) return `${x}${ri ? '\\le ' : '<'}${n(right)}`;
      if (right === Infinity) return `${x}${li ? '\\ge ' : '>'}${n(left)}`;
      return `${n(left)}${li ? '\\le ' : '<'}${x}${ri ? '\\le ' : '<'}${n(right)}`;
    });
    // 두 반직선이 한 점에서 끊긴 경우: x ≠ a
    if (ivs.length === 2 && ivs[0].left === -Infinity && ivs[1].right === Infinity && ivs[0].right === ivs[1].left && !ivs[0].ri && !ivs[1].li) {
      return `${x}\\ne ${n(ivs[0].right)}`;
    }
    return parts.join('\\text{ 또는 }');
  }

  function solveLinear(A, b) {
    const n = A.length;
    const M = A.map((r, i) => r.concat([b[i]]));
    for (let i = 0; i < n; i++) {
      let p = i;
      for (let k = i + 1; k < n; k++) if (Math.abs(M[k][i]) > Math.abs(M[p][i])) p = k;
      if (Math.abs(M[p][i]) < 1e-12) return null;
      [M[p], M[i]] = [M[i], M[p]];
      for (let k = 0; k < n; k++) {
        if (k === i) continue;
        const f = M[k][i] / M[i][i];
        for (let j = i; j <= n; j++) M[k][j] -= f * M[i][j];
      }
    }
    return M.map((r, i) => r[n] / r[i]);
  }

  function solveSystem(eqs, names, env) {
    const F = (vec) => {
      const scope = Object.fromEntries(names.map((nm, i) => [nm, vec[i]]));
      return eqs.map(([l, r]) => scalar(evaluate(l, env, scope), '방정식') - scalar(evaluate(r, env, scope), '방정식'));
    };
    const n = names.length;
    if (eqs.length !== n) {
      return { info: `식 ${eqs.length}개, 미지수 ${n}개(${names.join(', ')}) — 개수가 같아야 계산할 수 있어요` };
    }
    // 선형 검사
    let linear = true, A = null, b = null;
    try {
      const zero = Array(n).fill(0);
      const f0 = F(zero);
      A = eqs.map(() => Array(n).fill(0));
      for (let j = 0; j < n; j++) {
        const e = zero.slice(); e[j] = 1;
        const fj = F(e);
        for (let i = 0; i < eqs.length; i++) A[i][j] = fj[i] - f0[i];
      }
      b = f0.map((v) => -v);
      for (const trial of [[0.37, -1.3, 2.1, 0.5, -0.7, 1.9], [-2.2, 0.9, -0.4, 3.3, 1.1, -1.6]]) {
        const p = trial.slice(0, n);
        const fp = F(p);
        for (let i = 0; i < eqs.length; i++) {
          const pred = A[i].reduce((s, a, j) => s + a * p[j], 0) - b[i];
          if (Math.abs(pred - fp[i]) > 1e-8 * (1 + Math.abs(fp[i]))) linear = false;
        }
      }
      if ([...A.flat(), ...b].some((v) => !Number.isFinite(v))) linear = false;
    } catch (e) {
      if (e instanceof MErr && e.code !== 'error') throw e;
      linear = false;
    }
    if (linear) {
      const x = solveLinear(A, b);
      if (!x) return { info: '해가 없거나 무수히 많습니다 (계수 행렬식 = 0)' };
      return { solutions: [x.map((v) => snap(v, 1e-9))] };
    }
    // 비선형: 뉴턴법 다중 시작점
    let seed = 12345;
    const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
    const sols = [];
    const norm = (v) => Math.sqrt(v.reduce((s, x) => s + x * x, 0));
    for (let trial = 0; trial < 60; trial++) {
      let x = Array.from({ length: n }, () => (rnd() - 0.5) * (trial < 30 ? 6 : 40));
      let ok = false;
      for (let it = 0; it < 60; it++) {
        let f;
        try { f = F(x); } catch { break; }
        if (f.some((v) => !Number.isFinite(v))) break;
        if (norm(f) < 1e-12) { ok = true; break; }
        const J = [];
        for (let i = 0; i < n; i++) J.push(Array(n).fill(0));
        let bad = false;
        for (let j = 0; j < n; j++) {
          const h = 1e-7 * Math.max(1, Math.abs(x[j]));
          const xp = x.slice(); xp[j] += h;
          let fp;
          try { fp = F(xp); } catch { bad = true; break; }
          for (let i = 0; i < n; i++) J[i][j] = (fp[i] - f[i]) / h;
        }
        if (bad) break;
        const dx = solveLinear(J, f.map((v) => -v));
        if (!dx) break;
        let step = 1;
        const f0 = norm(f);
        let moved = false;
        for (let k = 0; k < 20; k++) {
          const xn = x.map((v, i) => v + step * dx[i]);
          let fn;
          try { fn = F(xn); } catch { step /= 2; continue; }
          if (fn.every(Number.isFinite) && norm(fn) < f0) { x = xn; moved = true; break; }
          step /= 2;
        }
        if (!moved) break;
      }
      if (!ok) { try { ok = norm(F(x)) < 1e-9; } catch { ok = false; } }
      if (ok) {
        const s = x.map((v) => snap(v, 1e-8));
        if (!sols.some((o) => o.every((v, i) => Math.abs(v - s[i]) < 1e-6 * Math.max(1, Math.abs(v))))) sols.push(s);
      }
    }
    if (!sols.length) return { info: '실수 해를 찾지 못했어요 (수치 탐색)' };
    sols.sort((p, q) => { for (let i = 0; i < n; i++) if (p[i] !== q[i]) return p[i] - q[i]; return 0; });
    return { solutions: sols.slice(0, 8), approx: true, more: sols.length > 8 };
  }

  // ------------------------------------------------------------------
  // 분석 (한 줄)
  // ------------------------------------------------------------------
  const sortNames = (set) => [...set].sort();

  function analyze(latex, env) {
    const src = String(latex || '').trim();
    if (!src) return { kind: 'empty' };
    try {
      // 함수 정의: f(x)=...
      const norm = normalize(src);
      const fm = /^\s*([a-zA-Z])\s*\(\s*([a-zA-Z])\s*\)\s*=([\s\S]*)$/.exec(norm);
      if (fm && fm[1] !== 'e' && fm[1] !== 'd' && fm[3].trim()) {
        const body = parse(fm[3]);
        if (body.t === 'cmp' || body.t === 'system') throw new MErr('함수 정의가 올바르지 않습니다');
        env.funcs[fm[1]] = { param: fm[2], body };
        return { kind: 'define', text: `함수 ${fm[1]}(${fm[2]}) 정의됨` };
      }
      const node = parse(src);
      return analyzeNode(node, env);
    } catch (e) {
      if (e instanceof MErr) {
        if (e.code === 'unsupported') return { kind: 'info', text: `${e.message} — 그대로 Claude에게 전달됩니다` };
        if (e.code === 'incomplete' || e.code === 'empty') return { kind: 'incomplete', text: e.message };
        if (e.code === 'symbolic') return { kind: 'info', text: `${e.message} — Claude에게 물어보세요` };
        if (e.code === 'free') return { kind: 'info', text: e.message };
        return { kind: 'error', text: e.message };
      }
      return { kind: 'error', text: '계산할 수 없습니다' };
    }
  }

  function analyzeNode(node, env) {
    if (node.t === 'system') return analyzeSystem(node, env);
    if (node.t === 'cmp') return analyzeCmp(node, env);
    return analyzeExpr(node, env);
  }

  function analyzeExpr(node, env) {
    const fv = freeVars(node, env);
    if (fv.size === 0) {
      const approx = hasApprox(node);
      const v = evaluate(node, env);
      const f = fmtValue(v, { approx, tol: approx ? 1e-9 : 1e-12 });
      return { kind: 'value', latex: f.latex, value: v };
    }
    if (hasDeriv(node)) {
      const d = simplify(expandDerivs(node, env));
      const out = { kind: 'symbolic', latex: toLatex(d) };
      return out;
    }
    if (hasIndefinite(node)) return { kind: 'info', text: '부정적분은 기호 계산이 필요해요 — Claude에게 물어보세요' };
    const names = sortNames(fv);
    return { kind: 'info', text: `${names.join(', ')} 값이 정해지지 않았어요 (예: 윗줄에 ${names[0]}=2 입력)`, free: names };
  }

  const hasApprox = (n) => ['int', 'lim'].includes(n.t) || (n.t === 'sum' && n.hi && n.hi.t === 'num' && n.hi.v === Infinity) || children(n).some(hasApprox);
  const hasIndefinite = (n) => (n.t === 'int' && n.lo === null) || children(n).some(hasIndefinite);

  const OP_LATEX = { '=': '=', '<': '<', '>': '>', '<=': '\\le', '>=': '\\ge', '!=': '\\ne', '≈': '\\approx' };

  function analyzeCmp(node, env) {
    const { ops, parts } = node;
    if (node.trailingEq) return analyzeExpr(parts[0], env);
    const fv = new Set();
    parts.forEach((p) => freeVars(p, env, new Set(), fv));
    // 변수 대입: a = 식
    if (ops.length === 1 && (ops[0] === '=') && parts[0].t === 'var' && freeVars(parts[1], env).size === 0) {
      const name = parts[0].name;
      const v = evaluate(parts[1], env);
      env.vars[name] = v;
      const f = fmtValue(v, { approx: hasApprox(parts[1]) });
      return { kind: 'assign', latex: `${name}=${f.latex}`, name, value: v };
    }
    if (fv.size === 0) {
      const vals = parts.map((p) => scalar(evaluate(p, env), '비교'));
      const ok = ops.every((op, i) => cmpHolds(op, vals[i], vals[i + 1]));
      const shown = vals.map((v) => numLatex(v, true)).join(',\\;');
      return { kind: 'bool', ok, latex: ok ? '\\text{성립 (참)}' : '\\text{성립하지 않음 (거짓)}', detail: `(${shown})` };
    }
    if (fv.size > 1) {
      return { kind: 'info', text: `미지수가 여러 개예요 (${sortNames(fv).join(', ')}). 연립방정식 버튼으로 식을 묶으면 풀 수 있어요` };
    }
    const x = [...fv][0];
    const at = (p, xv) => scalar(evaluate(p, env, { [x]: xv }), '방정식');
    if (ops.length === 1 && (ops[0] === '=' || ops[0] === '≈')) {
      const roots = findRoots((xv) => at(parts[0], xv) - at(parts[1], xv));
      if (!roots.length) return { kind: 'solutions', latex: '\\text{실수 해 없음}', note: '수치 탐색 범위 ±10000' };
      let shown = roots, note = '';
      if (roots.length > 10) {
        shown = roots.filter((r) => Math.abs(r) <= 10).slice(0, 10);
        if (!shown.length) shown = roots.slice(0, 10);
        note = '해가 많아 일부만 표시 (주기함수일 수 있음)';
      }
      const latex = shown.map((r) => `${x}=${numLatex(r, true, 1e-8)}`).join(',\\;');
      return { kind: 'solutions', latex, roots: shown, note };
    }
    // 부등식 (연쇄 포함)
    const pred = (xv) => {
      try {
        const vals = parts.map((p) => at(p, xv));
        if (vals.some((v) => !Number.isFinite(v))) return false;
        return ops.every((op, i) => cmpHolds(op, vals[i], vals[i + 1], 1e-14));
      } catch { return false; }
    };
    const ivs = solveIneq(pred);
    return { kind: 'solutions', latex: intervalsLatex(ivs, x), note: '수치 탐색' };
  }

  function analyzeSystem(node, env) {
    const items = [];
    const flat = (n) => (n.t === 'system' ? n.items.forEach(flat) : items.push(n));
    node.items.forEach(flat);
    const eqs = items.filter((n) => n.t === 'cmp' && n.ops.length === 1 && n.ops[0] === '=' && !n.trailingEq);
    if (eqs.length !== items.length) {
      // 연립이 아니면 각각 계산
      const res = items.map((n) => analyzeNode(n, env));
      const bad = res.find((r) => r.kind === 'error' || r.kind === 'incomplete');
      if (bad) return bad;
      const latex = res.map((r) => r.latex || `\\text{${r.text || ''}}`).join(',\\quad ');
      return { kind: 'value', latex };
    }
    const fv = new Set();
    eqs.forEach((e) => e.parts.forEach((p) => freeVars(p, env, new Set(), fv)));
    const names = sortNames(fv);
    if (!names.length) {
      const ok = eqs.every((e) => cmpHolds('=', scalar(evaluate(e.parts[0], env), '비교'), scalar(evaluate(e.parts[1], env), '비교')));
      return { kind: 'bool', ok, latex: ok ? '\\text{모두 성립 (참)}' : '\\text{성립하지 않음 (거짓)}' };
    }
    const r = solveSystem(eqs.map((e) => [e.parts[0], e.parts[1]]), names, env);
    if (r.info) return { kind: 'info', text: r.info };
    const latex = r.solutions.map((s) => s.map((v, i) => `${names[i]}=${numLatex(v, true, 1e-8)}`).join(',\\;')).join('\\quad\\text{또는}\\quad ');
    return { kind: 'solutions', latex, note: r.approx ? `수치 탐색${r.more ? ' (일부만 표시)' : ''}` : '' };
  }

  function analyzeAll(latexList, angle = 'RAD') {
    const env = makeEnv(angle);
    return latexList.map((l) => analyze(l, env));
  }

  return { parse, normalize, tokenize, analyze, analyzeAll, makeEnv, evaluate, toLatex, simplify, diff, MErr };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = MathNote;
