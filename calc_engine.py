"""공학계산기 수식 엔진.

eval()을 쓰지 않는 안전한 재귀 하강 파서로 수식을 계산한다.

지원 문법
  - 사칙연산: + - * / (× ÷ 기호도 허용), 거듭제곱 ^ (또는 **), 괄호
  - 후위 연산자: ! (팩토리얼), % (백분율 = /100)
  - 암시적 곱셈: 2pi, 3(4+5), (1+2)(3+4), 2sin(30)
  - 지수 표기: 1.5e-3, 6.02E23
  - 상수: pi(π), e, Ans
  - 함수: 아래 FUNCTIONS 참고
"""

from __future__ import annotations

import math
import random
from dataclasses import dataclass, field


class CalcError(Exception):
    """사용자에게 보여줄 계산 오류."""


# ---------------------------------------------------------------------------
# 토크나이저
# ---------------------------------------------------------------------------

@dataclass
class Token:
    kind: str  # NUM, IDENT, OP, LPAREN, RPAREN, COMMA, END
    value: object
    pos: int


_SYMBOL_MAP = {
    "×": "*", "÷": "/", "−": "-", "·": "*",
    "π": "pi", "√": "sqrt", "∛": "cbrt",
}

_OPS = set("+-*/^!%")


def tokenize(text: str) -> list[Token]:
    for k, v in _SYMBOL_MAP.items():
        # √, ∛ 뒤에 괄호가 없어도 다음 피연산자에 적용되도록 단항 함수로 취급
        text = text.replace(k, f" {v} " if k in "√∛" else v)
    text = text.replace("**", "^")

    tokens: list[Token] = []
    i, n = 0, len(text)
    while i < n:
        ch = text[i]
        if ch.isspace():
            i += 1
            continue
        if ch.isdigit() or (ch == "." and i + 1 < n and text[i + 1].isdigit()):
            start = i
            while i < n and (text[i].isdigit() or text[i] == "."):
                i += 1
            # 지수 표기
            if i < n and text[i] in "eE":
                j = i + 1
                if j < n and text[j] in "+-":
                    j += 1
                if j < n and text[j].isdigit():
                    i = j
                    while i < n and text[i].isdigit():
                        i += 1
            raw = text[start:i]
            if raw.count(".") > 1:
                raise CalcError(f"잘못된 숫자: {raw}")
            try:
                val = float(raw) if any(c in raw for c in ".eE") else int(raw)
            except ValueError:
                raise CalcError(f"잘못된 숫자: {raw}") from None
            tokens.append(Token("NUM", val, start))
            continue
        if ch.isalpha() or ch == "_":
            start = i
            while i < n and (text[i].isalnum() or text[i] == "_"):
                i += 1
            tokens.append(Token("IDENT", text[start:i], start))
            continue
        if ch in _OPS:
            tokens.append(Token("OP", ch, i))
        elif ch == "(":
            tokens.append(Token("LPAREN", ch, i))
        elif ch == ")":
            tokens.append(Token("RPAREN", ch, i))
        elif ch in ",;":
            tokens.append(Token("COMMA", ch, i))
        else:
            raise CalcError(f"알 수 없는 문자: '{ch}'")
        i += 1
    tokens.append(Token("END", None, n))
    return tokens


# ---------------------------------------------------------------------------
# 수학 함수
# ---------------------------------------------------------------------------

def _factorial(x):
    if isinstance(x, float):
        if not x.is_integer():
            # 비정수는 감마 함수로 확장
            if x < 0 and x.is_integer():
                raise CalcError("음수 팩토리얼은 정의되지 않음")
            return math.gamma(x + 1)
        x = int(x)
    if x < 0:
        raise CalcError("음수 팩토리얼은 정의되지 않음")
    if x > 5000:
        raise CalcError("팩토리얼 값이 너무 큽니다")
    return math.factorial(x)


def _as_int(x, name):
    if isinstance(x, float):
        if not x.is_integer():
            raise CalcError(f"{name}: 정수가 필요합니다")
        x = int(x)
    return x


def _npr(n, r):
    n, r = _as_int(n, "nPr"), _as_int(r, "nPr")
    if n < 0 or r < 0 or r > n:
        raise CalcError("nPr: 0 ≤ r ≤ n 이어야 합니다")
    return math.perm(n, r)


def _ncr(n, r):
    n, r = _as_int(n, "nCr"), _as_int(r, "nCr")
    if n < 0 or r < 0 or r > n:
        raise CalcError("nCr: 0 ≤ r ≤ n 이어야 합니다")
    return math.comb(n, r)


def _log(x, base=None):
    if x <= 0:
        raise CalcError("log: 양수만 가능합니다")
    if base is None:
        return math.log10(x)
    if base <= 0 or base == 1:
        raise CalcError("log: 밑이 올바르지 않습니다")
    return math.log(x, base)


def _ln(x):
    if x <= 0:
        raise CalcError("ln: 양수만 가능합니다")
    return math.log(x)


def _log2(x):
    if x <= 0:
        raise CalcError("log2: 양수만 가능합니다")
    return math.log2(x)


def _sqrt(x):
    if x < 0:
        raise CalcError("√: 음수의 제곱근은 실수가 아닙니다")
    r = math.isqrt(x) if isinstance(x, int) else None
    if r is not None and r * r == x:
        return r
    return math.sqrt(x)


def _cbrt(x):
    r = abs(x) ** (1 / 3)
    rr = round(r)
    if abs(rr ** 3 - abs(x)) < 1e-9 * max(1, abs(x)):
        r = rr
    return -r if x < 0 else r


def _root(x, n):
    if n == 0:
        raise CalcError("root: 0제곱근은 정의되지 않음")
    if x < 0:
        if float(n).is_integer() and int(n) % 2 == 1:
            return -((-x) ** (1 / n))
        raise CalcError("root: 음수의 짝수 제곱근은 실수가 아닙니다")
    return x ** (1 / n)


def _mod(a, b):
    if b == 0:
        raise CalcError("mod: 0으로 나눌 수 없습니다")
    return a % b


def _gcd(*args):
    return math.gcd(*(_as_int(a, "gcd") for a in args))


def _lcm(*args):
    return math.lcm(*(_as_int(a, "lcm") for a in args))


# ---------------------------------------------------------------------------
# 계산기 본체
# ---------------------------------------------------------------------------

ANGLE_MODES = ("DEG", "RAD", "GRAD")


@dataclass
class Calculator:
    angle_mode: str = "DEG"
    ans: float | int = 0
    variables: dict = field(default_factory=dict)

    # 각도 변환 -----------------------------------------------------------
    def _to_rad(self, x):
        if self.angle_mode == "DEG":
            return math.radians(x)
        if self.angle_mode == "GRAD":
            return x * math.pi / 200
        return x

    def _from_rad(self, x):
        if self.angle_mode == "DEG":
            return math.degrees(x)
        if self.angle_mode == "GRAD":
            return x * 200 / math.pi
        return x

    def _trig(self, fn):
        def f(x):
            r = self._to_rad(x)
            if fn is math.tan:
                # 90°, 270° 등에서 정의되지 않음
                c = math.cos(r)
                if abs(c) < 1e-12:
                    raise CalcError("tan: 정의되지 않는 각도입니다")
            v = fn(r)
            return 0.0 if abs(v) < 1e-12 else v
        return f

    def _inv_trig(self, fn, lo=None, hi=None):
        def f(x):
            if lo is not None and not (lo <= x <= hi):
                raise CalcError(f"{fn.__name__}: 정의역은 [{lo}, {hi}] 입니다")
            return self._from_rad(fn(x))
        return f

    @property
    def functions(self):
        return {
            "sin": self._trig(math.sin),
            "cos": self._trig(math.cos),
            "tan": self._trig(math.tan),
            "asin": self._inv_trig(math.asin, -1, 1),
            "acos": self._inv_trig(math.acos, -1, 1),
            "atan": self._inv_trig(math.atan),
            "sinh": math.sinh, "cosh": math.cosh, "tanh": math.tanh,
            "asinh": math.asinh, "acosh": math.acosh, "atanh": math.atanh,
            "ln": _ln, "log": _log, "log2": _log2,
            "exp": math.exp,
            "sqrt": _sqrt, "cbrt": _cbrt, "root": _root,
            "abs": abs,
            "fact": _factorial,
            "nPr": _npr, "nCr": _ncr, "npr": _npr, "ncr": _ncr,
            "floor": math.floor, "ceil": math.ceil,
            "round": lambda x, d=0: round(x, int(d)),
            "mod": _mod, "gcd": _gcd, "lcm": _lcm,
            "hypot": math.hypot,
            "deg": math.degrees, "rad": math.radians,
            "rand": random.random,
        }

    @property
    def constants(self):
        c = {"pi": math.pi, "e": math.e, "Ans": self.ans, "ans": self.ans,
             "phi": (1 + 5 ** 0.5) / 2}
        c.update(self.variables)
        return c

    # 공개 API ------------------------------------------------------------
    def evaluate(self, text: str, store_ans: bool = True):
        text = text.strip()
        if not text:
            raise CalcError("수식이 비어 있습니다")
        # 변수 대입: x = 3+4
        target = None
        if "=" in text:
            left, right = text.split("=", 1)
            left = left.strip()
            if not left.isidentifier():
                raise CalcError("대입식의 왼쪽은 변수 이름이어야 합니다")
            if left in self.functions or left in ("pi", "e", "Ans", "ans"):
                raise CalcError(f"'{left}'은(는) 예약된 이름입니다")
            target, text = left, right
        parser = _Parser(tokenize(text), self)
        try:
            result = parser.parse()
        except ZeroDivisionError:
            raise CalcError("0으로 나눌 수 없습니다") from None
        except OverflowError:
            raise CalcError("결과가 너무 큽니다 (오버플로)") from None
        except (ValueError, TypeError) as exc:
            raise CalcError(f"계산 오류: {exc}") from None
        if isinstance(result, float):
            if math.isnan(result):
                raise CalcError("정의되지 않는 결과입니다")
            if math.isinf(result):
                raise CalcError("결과가 너무 큽니다 (무한대)")
        if target:
            self.variables[target] = result
        if store_ans:
            self.ans = result
        return result


class _Parser:
    def __init__(self, tokens: list[Token], calc: Calculator):
        self.tokens = tokens
        self.i = 0
        self.calc = calc
        self.funcs = calc.functions
        self.consts = calc.constants

    def peek(self) -> Token:
        return self.tokens[self.i]

    def next(self) -> Token:
        tok = self.tokens[self.i]
        self.i += 1
        return tok

    def expect(self, kind):
        tok = self.next()
        if tok.kind != kind:
            want = {"RPAREN": "')'", "LPAREN": "'('"}.get(kind, kind)
            raise CalcError(f"{want}이(가) 필요합니다")
        return tok

    def parse(self):
        if self.peek().kind == "END":
            raise CalcError("수식이 비어 있습니다")
        v = self.expr()
        tok = self.peek()
        if tok.kind == "RPAREN":
            raise CalcError("괄호 짝이 맞지 않습니다")
        if tok.kind != "END":
            raise CalcError(f"예상치 못한 입력: '{tok.value}'")
        return v

    # expr := term (('+'|'-') term)*
    def expr(self):
        v = self.term()
        while self.peek().kind == "OP" and self.peek().value in "+-":
            op = self.next().value
            r = self.term()
            v = v + r if op == "+" else v - r
        return v

    # term := unary (('*'|'/') unary | <암시적 곱셈> power)*
    def term(self):
        v = self.unary()
        while True:
            tok = self.peek()
            if tok.kind == "OP" and tok.value in "*/":
                self.next()
                r = self.unary()
                if tok.value == "*":
                    v = v * r
                else:
                    if r == 0:
                        raise CalcError("0으로 나눌 수 없습니다")
                    v = _div(v, r)
            elif tok.kind in ("NUM", "IDENT", "LPAREN"):
                v = v * self.power()
            else:
                return v

    # unary := ('+'|'-') unary | power
    def unary(self):
        tok = self.peek()
        if tok.kind == "OP" and tok.value in "+-":
            self.next()
            v = self.unary()
            return -v if tok.value == "-" else v
        return self.power()

    # power := postfix ('^' unary)?   (우결합, -2^2 = -4)
    def power(self):
        base = self.postfix()
        if self.peek().kind == "OP" and self.peek().value == "^":
            self.next()
            exp = self.unary()
            return _pow(base, exp)
        return base

    # postfix := primary ('!' | '%')*
    def postfix(self):
        v = self.primary()
        while self.peek().kind == "OP" and self.peek().value in "!%":
            op = self.next().value
            v = _factorial(v) if op == "!" else v / 100
        return v

    def primary(self):
        tok = self.next()
        if tok.kind == "NUM":
            return tok.value
        if tok.kind == "LPAREN":
            v = self.expr()
            # 닫는 괄호 생략 허용 (끝에서)
            if self.peek().kind == "END":
                return v
            self.expect("RPAREN")
            return v
        if tok.kind == "IDENT":
            name = tok.value
            if name in self.funcs:
                return self.call(name)
            if name in self.consts:
                return self.consts[name]
            raise CalcError(f"알 수 없는 이름: '{name}'")
        if tok.kind == "END":
            raise CalcError("수식이 완성되지 않았습니다")
        raise CalcError(f"예상치 못한 입력: '{tok.value}'")

    def call(self, name):
        fn = self.funcs[name]
        if self.peek().kind != "LPAREN":
            # 괄호 없이 쓴 경우: sin 30, √2  → 다음 거듭제곱 항에 적용
            if name == "rand":
                return fn()
            return fn(self.power())
        self.next()
        args = []
        if self.peek().kind != "RPAREN":
            args.append(self.expr())
            while self.peek().kind == "COMMA":
                self.next()
                args.append(self.expr())
        if self.peek().kind != "END":
            self.expect("RPAREN")
        try:
            return fn(*args)
        except TypeError:
            raise CalcError(f"{name}: 인수 개수가 올바르지 않습니다") from None
        except ValueError:
            raise CalcError(f"{name}: 정의역을 벗어났습니다") from None


def _div(a, b):
    if isinstance(a, int) and isinstance(b, int) and a % b == 0:
        return a // b
    return a / b


def _pow(a, b):
    if isinstance(a, int) and isinstance(b, int) and b >= 0:
        if abs(a) > 1 and b * math.log10(abs(a)) > 10000:
            raise CalcError("결과가 너무 큽니다 (오버플로)")
        return a ** b
    if a == 0 and b < 0:
        raise CalcError("0으로 나눌 수 없습니다")
    if a < 0 and not float(b).is_integer():
        # 홀수 분모의 유리수 지수: (-8)^(1/3) = -2
        inv = 1 / b
        if abs(inv - round(inv)) < 1e-9 and round(inv) % 2 == 1:
            return -((-a) ** b)
        raise CalcError("음수의 비정수 거듭제곱은 실수가 아닙니다")
    return float(a) ** b if isinstance(b, float) or b < 0 else a ** b


# ---------------------------------------------------------------------------
# 결과 서식
# ---------------------------------------------------------------------------

DISPLAY_MODES = ("NORM", "SCI", "ENG", "FIX")


def format_number(x, mode: str = "NORM", digits: int = 10) -> str:
    """mode: NORM(일반) / SCI(과학 표기) / ENG(공학 표기, 지수 3의 배수) / FIX(소수 고정)."""
    if isinstance(x, bool):
        x = int(x)
    if isinstance(x, int) and mode == "NORM":
        s = str(x)
        if len(s.lstrip("-")) <= 15:
            return s
        x = float(x) if abs(x) < 1e308 else x
        if isinstance(x, int):
            # 너무 큰 정수: 직접 과학 표기
            neg, s = x < 0, str(abs(x))
            mant = s[0] + "." + s[1:digits].rstrip("0")
            mant = mant.rstrip(".")
            return f"{'-' if neg else ''}{mant}E{len(s) - 1}"
    x = float(x)
    if x == 0:
        return "0" if mode in ("NORM",) else _format_zero(mode, digits)

    if mode == "FIX":
        return f"{x:,.{digits}f}".replace(",", "")
    if mode == "SCI":
        mant, exp = f"{x:.{digits - 1}e}".split("e")
        mant = mant.rstrip("0").rstrip(".") if "." in mant else mant
        return f"{mant}E{int(exp)}"
    if mode == "ENG":
        exp = int(math.floor(math.log10(abs(x))))
        exp3 = exp - (exp % 3)
        mant = x / 10 ** exp3
        # 반올림으로 1000이 되는 경우 보정
        mant = float(f"{mant:.{digits}g}")
        if abs(mant) >= 1000:
            mant /= 1000
            exp3 += 3
        m = f"{mant:.{digits}g}"
        return f"{m}E{exp3}"

    # NORM: 12자리 유효숫자, 너무 크거나 작으면 과학 표기
    ax = abs(x)
    if 1e-9 <= ax < 1e15:
        s = f"{x:.12g}"
        if "e" in s:
            s = f"{x:.12f}".rstrip("0").rstrip(".")
        return s
    mant, exp = f"{x:.{digits - 1}e}".split("e")
    mant = mant.rstrip("0").rstrip(".")
    return f"{mant}E{int(exp)}"


def _format_zero(mode, digits):
    if mode == "FIX":
        return f"{0:.{digits}f}"
    return "0E0"


def to_base(x, base: int) -> str:
    """정수 결과를 2/8/16진수 문자열로."""
    if isinstance(x, float):
        if not x.is_integer():
            return "—"
        x = int(x)
    prefix = {2: "0b", 8: "0o", 16: "0x"}[base]
    s = format(abs(x), {2: "b", 8: "o", 16: "X"}[base])
    return ("-" if x < 0 else "") + prefix + s
