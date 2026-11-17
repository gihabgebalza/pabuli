// 실행: node mathnote/tests/engine.test.js
const M = require('../engine.js');

let fail = 0, pass = 0;
const SEP = ',\\;';

function check(desc, lines, pred, angle = 'RAD') {
  let r;
  try { r = M.analyzeAll(Array.isArray(lines) ? lines : [lines], angle); } catch (e) { r = [{ kind: 'CRASH', text: e.stack }]; }
  const last = r[r.length - 1];
  let ok = false;
  try { ok = pred(last); } catch (e) { ok = false; }
  if (ok) pass++;
  else { fail++; console.log('FAIL', desc, JSON.stringify(lines), '\n     ->', JSON.stringify(last)); }
}
const val = (v, tol = 1e-9) => (r) => r.kind === 'value' && Math.abs(r.value - v) <= tol * Math.max(1, Math.abs(v));
const lx = (s) => (r) => r.latex === s;
const has = (s) => (r) => (r.latex || '').includes(s);
const kind = (k) => (r) => r.kind === k;

// 기본 계산
check('frac', '\\frac{1}{2}+\\frac{1}{3}', (r) => val(5 / 6)(r) && r.latex.startsWith('\\frac{5}{6}'));
check('pow', '2^{10}', lx('1024'));
check('implicit', '2\\pi', (r) => val(2 * Math.PI)(r) && r.latex.startsWith('2\\pi'));
check('sqrt', '\\sqrt{8}', has('2\\sqrt{2}'));
check('nroot', '\\sqrt[3]{-27}', val(-3));
check('left right', '\\left(1+2\\right)\\cdot3', val(9));
check('sin rad', '\\sin\\left(\\frac{\\pi}{6}\\right)', val(0.5));
check('sin deg sym', '\\sin(30^{\\circ})', val(0.5));
check('sin deg mode', '\\sin 30', val(0.5), 'DEG');
check('sin^2 free', '\\sin^{2}x+\\cos^{2}x', kind('info'));
check('arcsin', '\\sin^{-1}(1)', val(Math.PI / 2));
check('log10', '\\log(1000)', val(3));
check('log base', '\\log_{2}8', val(3));
check('ln e', '\\ln e', val(1));
check('exp', 'e^{2}', val(Math.E ** 2));
check('fact', '5!', val(120));
check('abs', '\\left|-3\\right|', val(3));
check('abs2', '|2-5|+|1|', val(4));
check('div0', '\\frac{1}{0}', kind('error'));
check('sqrt neg', '\\sqrt{-1}', kind('error'));
check('placeholder', '\\frac{\\placeholder{}}{2}', kind('incomplete'));
check('times', '3\\times4', val(12));
check('sci', '1.5\\times10^{3}', val(1500));
check('percent', '50\\%', val(0.5));
check('trailing eq', '3+4=', val(7));
check('binom', '\\binom{5}{2}', val(10));
check('unicode', '2×3−1', val(5));

// 변수/함수
check('assign', ['a=3', '2a+1'], val(7));
check('assign show', 'a=\\frac{1}{4}', (r) => r.kind === 'assign' && r.latex.startsWith('a=\\frac{1}{4}'));
check('func', ['f(x)=x^{2}+1', 'f(3)'], val(10));
check('func prime', ['f(x)=x^{3}', "f'(2)"], val(12));
check('func prime sym', ['f(x)=x^{3}', "f'(x)"], (r) => r.kind === 'symbolic' && r.latex === '3x^{2}');
check('free var', 'x^{2}+1', kind('info'));

// 미적분
check('defint', '\\int_{0}^{1}x^{2}\\,\\mathrm{d}x', (r) => val(1 / 3, 1e-9)(r) && r.latex.includes('\\frac{1}{3}'));
check('defint dx', '\\int_0^{\\pi}\\sin x\\,dx', val(2, 1e-9));
check('defint inf', '\\int_{0}^{\\infty}e^{-x}dx', val(1, 1e-8));
check('gauss', '\\int_{-\\infty}^{\\infty}e^{-x^{2}}dx', val(Math.sqrt(Math.PI), 1e-8));
check('singular', '\\int_{0}^{1}\\frac{1}{\\sqrt{x}}dx', val(2, 1e-6));
check('indefinite', '\\int x^{2}dx', kind('info'));
check('deriv sym', '\\frac{\\mathrm{d}}{\\mathrm{d}x}\\left(x^{3}+2x\\right)', (r) => r.kind === 'symbolic' && r.latex === '3x^{2}+2');
check('deriv sin', '\\frac{d}{dx}\\sin(x^{2})', (r) => r.kind === 'symbolic' && r.latex === '2x\\cos\\left(x^{2}\\right)');
check('deriv 2nd', '\\frac{d^{2}}{dx^{2}}x^{4}', (r) => r.kind === 'symbolic' && r.latex === '12x^{2}');
check('deriv at point', ['x=2', '\\frac{d}{dx}x^{3}'], val(12));
check('deriv ln', '\\frac{d}{dx}\\ln x', (r) => r.latex === '\\frac{1}{x}');
check('deriv exp', '\\frac{d}{dx}e^{2x}', (r) => r.kind === 'symbolic' && r.latex.includes('e^{2x}'));
check('lim sinx/x', '\\lim_{x\\to0}\\frac{\\sin x}{x}', (r) => r.kind === 'value' && Math.abs(r.value - 1) < 1e-7);
check('lim inf', '\\lim_{x\\to\\infty}\\left(1+\\frac{1}{x}\\right)^{x}', (r) => r.kind === 'value' && Math.abs(r.value - Math.E) < 1e-6);
check('lim 1-cos', '\\lim_{x\\to0}\\frac{1-\\cos x}{x^{2}}', (r) => r.kind === 'value' && Math.abs(r.value - 0.5) < 1e-7);
check('lim 1/x', '\\lim_{x\\to0}\\frac{1}{x}', kind('error'));
check('lim 1/x right', '\\lim_{x\\to0^{+}}\\frac{1}{x}', (r) => r.kind === 'value' && r.value === Infinity);
check('lim poly', '\\lim_{x\\to2}\\frac{x^{2}-4}{x-2}', (r) => r.kind === 'value' && Math.abs(r.value - 4) < 1e-7);
check('sum', '\\sum_{n=1}^{10}n^{2}', val(385));
check('sum inf', '\\sum_{n=1}^{\\infty}\\frac{1}{n^{2}}', (r) => r.kind === 'value' && Math.abs(r.value - Math.PI ** 2 / 6) < 1e-6);
check('sum geo', '\\sum_{n=0}^{\\infty}\\frac{1}{2^{n}}', (r) => r.kind === 'value' && Math.abs(r.value - 2) < 1e-9);
check('sum harmonic', '\\sum_{n=1}^{\\infty}\\frac{1}{n}', kind('error'));
check('prod', '\\prod_{k=1}^{5}k', val(120));

// 방정식/부등식
check('quad eq', 'x^{2}-5x+6=0', lx(`x=2${SEP}x=3`));
check('double root', '\\left(x-1\\right)^{2}=0', lx('x=1'));
check('irrational', 'x^{2}=2', lx(`x=-\\sqrt{2}${SEP}x=\\sqrt{2}`));
check('no real', 'x^{2}+1=0', has('실수 해 없음'));
check('exp eq', 'e^{x}=10', (r) => r.kind === 'solutions' && Math.abs(r.roots[0] - Math.log(10)) < 1e-9);
check('trig eq', '\\sin x=0.5', (r) => r.kind === 'solutions' && !!r.note);
check('frac eq', '\\frac{1}{x}=4', lx('x=\\frac{1}{4}'));
check('ineq', 'x^{2}-5x+6>0', lx('x<2\\text{ 또는 }x>3'));
check('ineq le', 'x^{2}\\le4', lx('-2\\le x\\le 2'));
check('ineq chain', '1<2x+1\\le7', lx('0<x\\le 3'));
check('ineq all', 'x^{2}+1>0', has('모든 실수'));
check('ineq none', 'x^{2}<0', has('해 없음'));
check('ineq point', 'x^{2}\\le0', lx('x=0'));
check('ineq ne', '\\left(x-1\\right)^{2}>0', lx('x\\ne 1'));
check('bool', '2+2=4', (r) => r.kind === 'bool' && r.ok);
check('bool false', '3>5', (r) => r.kind === 'bool' && !r.ok);
check('multi var', 'x+y=3', kind('info'));
check('system linear', '\\begin{cases}x+y=3\\\\x-y=1\\end{cases}', lx(`x=2${SEP}y=1`));
check('system 3', '\\begin{cases}x+y+z=6\\\\2x-y+z=3\\\\x+2y-z=2\\end{cases}', lx(`x=1${SEP}y=2${SEP}z=3`));
check('system nonlinear', '\\begin{cases}x^{2}+y^{2}=25\\\\x+y=7\\end{cases}',
  (r) => r.kind === 'solutions' && r.latex.includes(`x=3${SEP}y=4`) && r.latex.includes(`x=4${SEP}y=3`));
check('system singular', '\\begin{cases}x+y=1\\\\2x+2y=2\\end{cases}', kind('info'));

// 행렬
const A = '\\begin{pmatrix}1&2\\\\3&4\\end{pmatrix}';
check('det', `\\det${A}`, val(-2));
check('vmatrix', '\\begin{vmatrix}1&2\\\\3&4\\end{vmatrix}', val(-2));
check('inv', `${A}^{-1}`, lx('\\begin{pmatrix}-2&1\\\\\\frac{3}{2}&-\\frac{1}{2}\\end{pmatrix}'));
check('matmul', `${A}${A}`, lx('\\begin{pmatrix}7&10\\\\15&22\\end{pmatrix}'));
check('transpose', `${A}^{T}`, lx('\\begin{pmatrix}1&3\\\\2&4\\end{pmatrix}'));
check('mat assign', [`A=${A}`, 'A^{2}-5A'], lx('\\begin{pmatrix}2&0\\\\0&2\\end{pmatrix}'));
check('dot', '\\begin{pmatrix}1\\\\2\\\\3\\end{pmatrix}\\cdot\\begin{pmatrix}4\\\\5\\\\6\\end{pmatrix}', val(32));
check('cross', '\\begin{pmatrix}1\\\\0\\\\0\\end{pmatrix}\\times\\begin{pmatrix}0\\\\1\\\\0\\end{pmatrix}', lx('\\begin{pmatrix}0\\\\0\\\\1\\end{pmatrix}'));
check('norm', '\\left|\\begin{pmatrix}3\\\\4\\end{pmatrix}\\right|', val(5));
check('mat size err', `${A}+\\begin{pmatrix}1\\\\2\\end{pmatrix}`, kind('error'));
check('singular inv', '\\begin{pmatrix}1&2\\\\2&4\\end{pmatrix}^{-1}', kind('error'));

// 계산하지 않는 기호 / 그리스 문자
check('unsupported', '\\forall x\\in\\mathbb{R}', (r) => r.kind === 'info' || r.kind === 'error');
check('greek var', ['\\alpha=2', '3\\alpha'], val(6));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
