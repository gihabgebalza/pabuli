"""공학계산기 (데스크탑, Tkinter).

실행:  python engcalc.py
"""

from __future__ import annotations

import json
import sys
import tkinter as tk
import tkinter.font as tkfont
from pathlib import Path
from tkinter import messagebox

from calc_engine import (ANGLE_MODES, DISPLAY_MODES, CalcError, Calculator,
                         format_number, to_base)

APP_TITLE = "공학계산기"
STATE_FILE = Path.home() / ".engcalc_state.json"
MAX_HISTORY = 200

# 색상 테마 -----------------------------------------------------------------
C = {
    "bg": "#1e1f24",
    "panel": "#26282f",
    "display": "#15161a",
    "text": "#e8e9ed",
    "muted": "#8b8f9c",
    "accent": "#f0a030",
    "error": "#ff6b6b",
    "num": "#3a3d47",
    "num_hover": "#474b57",
    "fn": "#2d3039",
    "fn_hover": "#3a3e49",
    "op": "#4a4f5e",
    "op_hover": "#5a6072",
    "eq": "#f0a030",
    "eq_hover": "#ffb64d",
    "ctrl": "#5a3a3a",
    "ctrl_hover": "#6e4646",
    "toggle_on": "#2f6fb0",
    "press": "#16171b",
}


def pick_font(root, candidates, size, weight="normal"):
    families = set(tkfont.families(root))
    for fam in candidates:
        if fam in families:
            return tkfont.Font(root=root, family=fam, size=size, weight=weight)
    return tkfont.Font(root=root, size=size, weight=weight)


class FlatButton(tk.Label):
    """플랫폼과 무관하게 색이 적용되는 버튼 (macOS의 tk.Button은 배경색을 무시함)."""

    def __init__(self, master, text, command, kind="num", font=None, sub=None):
        self.kind = kind
        self.base = C[kind]
        self.hover = C[kind + "_hover"]
        super().__init__(master, text=text, bg=self.base,
                         fg="#1e1f24" if kind == "eq" else C["text"],
                         font=font, padx=4, pady=6, cursor="hand2")
        self.command = command
        self._inside = False
        self.bind("<Enter>", self._on_enter)
        self.bind("<Leave>", self._on_leave)
        self.bind("<ButtonPress-1>", lambda e: self.config(bg=C["press"]))
        self.bind("<ButtonRelease-1>", self._on_release)
        if sub:
            Tooltip(self, sub)

    def set_colors(self, base, hover):
        self.base, self.hover = base, hover
        self.config(bg=hover if self._inside else base)

    def _on_enter(self, _):
        self._inside = True
        self.config(bg=self.hover)

    def _on_leave(self, _):
        self._inside = False
        self.config(bg=self.base)

    def _on_release(self, e):
        inside = 0 <= e.x < self.winfo_width() and 0 <= e.y < self.winfo_height()
        self.config(bg=self.hover if inside else self.base)
        if inside:
            self.command()


class Tooltip:
    def __init__(self, widget, text):
        self.widget, self.text, self.tip, self.job = widget, text, None, None
        widget.bind("<Enter>", self._schedule, add="+")
        widget.bind("<Leave>", self._hide, add="+")
        widget.bind("<ButtonPress>", self._hide, add="+")

    def _schedule(self, _):
        self.job = self.widget.after(600, self._show)

    def _show(self):
        if self.tip:
            return
        x = self.widget.winfo_rootx() + 10
        y = self.widget.winfo_rooty() + self.widget.winfo_height() + 4
        self.tip = tk.Toplevel(self.widget)
        self.tip.wm_overrideredirect(True)
        self.tip.wm_geometry(f"+{x}+{y}")
        tk.Label(self.tip, text=self.text, bg="#ffffe0", fg="#000",
                 relief="solid", borderwidth=1, padx=6, pady=2).pack()

    def _hide(self, _=None):
        if self.job:
            self.widget.after_cancel(self.job)
            self.job = None
        if self.tip:
            self.tip.destroy()
            self.tip = None


# 과학 함수 버튼: (라벨, 입력할 텍스트, 2nd 라벨, 2nd 입력, 툴팁)
SCI_KEYS = [
    [("2nd", "@2nd"), ("DEG", "@angle"), ("NORM", "@disp"), ("(−)", "-"), (",", ",")],
    [("sin", "sin(", "sin⁻¹", "asin(", "사인 / 역사인"),
     ("cos", "cos(", "cos⁻¹", "acos(", "코사인 / 역코사인"),
     ("tan", "tan(", "tan⁻¹", "atan(", "탄젠트 / 역탄젠트"),
     ("ln", "ln(", "eˣ", "exp(", "자연로그 / e의 거듭제곱"),
     ("log", "log(", "10ˣ", "10^(", "상용로그 (log(x,밑) 가능) / 10의 거듭제곱")],
    [("sinh", "sinh(", "sinh⁻¹", "asinh(", "쌍곡사인"),
     ("cosh", "cosh(", "cosh⁻¹", "acosh(", "쌍곡코사인"),
     ("tanh", "tanh(", "tanh⁻¹", "atanh(", "쌍곡탄젠트"),
     ("log₂", "log2(", "2ˣ", "2^(", "이진로그 / 2의 거듭제곱"),
     ("|x|", "abs(", "mod", "mod(", "절댓값 / 나머지 mod(a,b)")],
    [("x²", "^2", "x³", "^3", "제곱 / 세제곱"),
     ("xʸ", "^", "ʸ√x", "root(", "거듭제곱 / y제곱근 root(x,y)"),
     ("√", "√(", "∛", "cbrt(", "제곱근 / 세제곱근"),
     ("1/x", "^(-1)", "x⁻²", "^(-2)", "역수"),
     ("n!", "!", "Γ", "fact(", "팩토리얼")],
    [("nPr", "nPr(", "gcd", "gcd(", "순열 nPr(n,r) / 최대공약수"),
     ("nCr", "nCr(", "lcm", "lcm(", "조합 nCr(n,r) / 최소공배수"),
     ("Ran#", "rand()", "round", "round(", "난수 / 반올림 round(x,자리)"),
     ("π", "π", "φ", "phi", "원주율 / 황금비"),
     ("e", "e", "hypot", "hypot(", "자연상수 / 빗변 hypot(a,b)")],
    [("(", "("), (")", ")"), ("Ans", "Ans"), ("x", "x", "y", "y", "변수 (x=5 처럼 대입)"),
     ("=", "=", "→", "=", "변수 대입 기호")],
]

NUM_KEYS = [
    [("MC", "@mc", "ctrl"), ("MR", "@mr", "fn"), ("M+", "@m+", "fn"), ("M−", "@m-", "fn")],
    [("AC", "@clear", "ctrl"), ("⌫", "@back", "ctrl"), ("%", "%", "op"), ("÷", "÷", "op")],
    [("7", "7"), ("8", "8"), ("9", "9"), ("×", "×", "op")],
    [("4", "4"), ("5", "5"), ("6", "6"), ("−", "-", "op")],
    [("1", "1"), ("2", "2"), ("3", "3"), ("+", "+", "op")],
    [("0", "0"), (".", "."), ("EXP", "E", "fn"), ("=", "@eval", "eq")],
]

HELP_TEXT = """\
■ 입력
  키보드로 수식을 직접 입력하거나 버튼을 누르세요.
  Enter = 계산,  Esc = 지우기,  ↑/↓ = 이전 수식 불러오기
  Ctrl+Shift+C = 결과 복사

■ 연산자
  + − × ÷   ^ (거듭제곱)   ! (팩토리얼)   % (÷100)
  암시적 곱셈: 2π, 3(4+5), 2sin(30)
  지수 표기: 6.02E23, 1.5e-3

■ 함수
  sin cos tan asin acos atan   sinh cosh tanh asinh acosh atanh
  ln log log2 exp   sqrt(√) cbrt(∛) root(x,n)
  abs mod(a,b) fact nPr(n,r) nCr(n,r) gcd lcm
  floor ceil round(x,자리) hypot(a,b) deg(rad) rad(deg) rand()
  log(x, 밑) 으로 임의의 밑 로그 계산

■ 상수 / 변수
  pi(π), e, phi(φ), Ans(직전 결과)
  x = 3*4 처럼 변수에 값을 저장하고 2x+1 처럼 사용

■ 모드
  DEG / RAD / GRAD : 각도 단위 (버튼 클릭으로 전환, F3)
  NORM / SCI / ENG / FIX : 결과 표시 형식 (F4)
  2nd : 버튼의 보조 기능 (역삼각함수 등)
"""


class EngCalcApp:
    def __init__(self, root: tk.Tk):
        self.root = root
        self.calc = Calculator()
        self.display_mode = "NORM"
        self.fix_digits = 4
        self.memory = 0
        self.history: list[tuple[str, str]] = []  # (수식, 결과 텍스트)
        self.hist_index = None
        self.just_evaluated = False
        self.second = False
        self.last_result = None
        self._load_state()

        root.title(APP_TITLE)
        root.configure(bg=C["bg"])
        root.minsize(760, 520)
        root.geometry("1000x620")

        mono = ["Cascadia Mono", "Consolas", "SF Mono", "Menlo", "DejaVu Sans Mono",
                "Liberation Mono", "Courier New"]
        sans = ["Segoe UI", "Malgun Gothic", "Apple SD Gothic Neo", "SF Pro Text",
                "Noto Sans CJK KR", "Noto Sans", "DejaVu Sans", "Helvetica"]
        self.f_expr = pick_font(root, mono, 18)
        self.f_result = pick_font(root, mono, 30, "bold")
        self.f_small = pick_font(root, sans, 10)
        self.f_btn = pick_font(root, sans, 13)
        self.f_btn_num = pick_font(root, sans, 16, "bold")
        self.f_hist = pick_font(root, mono, 11)

        self._build_menu()
        self._build_ui()
        self._bind_keys()
        self._refresh_status()
        self._refresh_history()
        self.entry.focus_set()
        root.protocol("WM_DELETE_WINDOW", self._on_close)

    # ------------------------------------------------------------------ UI
    def _build_menu(self):
        m = tk.Menu(self.root)
        fm = tk.Menu(m, tearoff=0)
        fm.add_command(label="기록 지우기", command=self._clear_history)
        fm.add_separator()
        fm.add_command(label="종료", command=self._on_close)
        m.add_cascade(label="파일", menu=fm)

        em = tk.Menu(m, tearoff=0)
        em.add_command(label="결과 복사", accelerator="Ctrl+Shift+C", command=self._copy_result)
        em.add_command(label="수식 복사", command=self._copy_expr)
        em.add_command(label="붙여넣기", accelerator="Ctrl+V",
                       command=lambda: self.entry.event_generate("<<Paste>>"))
        m.add_cascade(label="편집", menu=em)

        vm = tk.Menu(m, tearoff=0)
        self.var_angle = tk.StringVar(value=self.calc.angle_mode)
        for a in ANGLE_MODES:
            vm.add_radiobutton(label=a, variable=self.var_angle, value=a,
                               command=lambda a=a: self._set_angle(a))
        vm.add_separator()
        self.var_disp = tk.StringVar(value=self.display_mode)
        for d in DISPLAY_MODES:
            vm.add_radiobutton(label=d, variable=self.var_disp, value=d,
                               command=lambda d=d: self._set_disp(d))
        fixm = tk.Menu(vm, tearoff=0)
        self.var_fix = tk.IntVar(value=self.fix_digits)
        for n in range(0, 11):
            fixm.add_radiobutton(label=str(n), variable=self.var_fix, value=n,
                                 command=lambda n=n: self._set_fix(n))
        vm.add_cascade(label="FIX/SCI 자릿수", menu=fixm)
        vm.add_separator()
        self.var_top = tk.BooleanVar(value=False)
        vm.add_checkbutton(label="항상 위에 표시", variable=self.var_top,
                           command=lambda: self.root.attributes("-topmost", self.var_top.get()))
        m.add_cascade(label="보기", menu=vm)

        hm = tk.Menu(m, tearoff=0)
        hm.add_command(label="사용법", accelerator="F1", command=self._show_help)
        m.add_cascade(label="도움말", menu=hm)
        self.root.config(menu=m)

    def _build_ui(self):
        root = self.root
        root.columnconfigure(0, weight=3)
        root.columnconfigure(1, weight=1, minsize=220)
        root.rowconfigure(0, weight=1)

        main = tk.Frame(root, bg=C["bg"])
        main.grid(row=0, column=0, sticky="nsew", padx=(10, 5), pady=10)
        main.columnconfigure(0, weight=1)
        main.rowconfigure(1, weight=1)

        # --- 디스플레이
        disp = tk.Frame(main, bg=C["display"], padx=12, pady=8)
        disp.grid(row=0, column=0, sticky="ew")
        disp.columnconfigure(0, weight=1)

        status = tk.Frame(disp, bg=C["display"])
        status.grid(row=0, column=0, sticky="ew")
        self.lbl_angle = tk.Label(status, bg=C["display"], fg=C["accent"], font=self.f_small)
        self.lbl_angle.pack(side="left")
        self.lbl_disp = tk.Label(status, bg=C["display"], fg=C["muted"], font=self.f_small)
        self.lbl_disp.pack(side="left", padx=(10, 0))
        self.lbl_2nd = tk.Label(status, bg=C["display"], fg=C["accent"], font=self.f_small)
        self.lbl_2nd.pack(side="left", padx=(10, 0))
        self.lbl_mem = tk.Label(status, bg=C["display"], fg=C["muted"], font=self.f_small)
        self.lbl_mem.pack(side="right")

        self.expr_var = tk.StringVar()
        self.entry = tk.Entry(disp, textvariable=self.expr_var, font=self.f_expr,
                              bg=C["display"], fg=C["text"], insertbackground=C["accent"],
                              relief="flat", highlightthickness=0, justify="right")
        self.entry.grid(row=1, column=0, sticky="ew", pady=(6, 0))
        self.expr_var.trace_add("write", lambda *_: self._on_expr_change())

        self.result_var = tk.StringVar(value="0")
        self.lbl_result = tk.Label(disp, textvariable=self.result_var, font=self.f_result,
                                   bg=C["display"], fg=C["text"], anchor="e")
        self.lbl_result.grid(row=2, column=0, sticky="ew")

        self.base_var = tk.StringVar()
        tk.Label(disp, textvariable=self.base_var, font=self.f_small, bg=C["display"],
                 fg=C["muted"], anchor="e").grid(row=3, column=0, sticky="ew")

        # --- 키패드
        pads = tk.Frame(main, bg=C["bg"])
        pads.grid(row=1, column=0, sticky="nsew", pady=(10, 0))
        pads.columnconfigure(0, weight=5, uniform="pad")
        pads.columnconfigure(1, weight=4, uniform="pad")
        pads.rowconfigure(0, weight=1)

        sci = tk.Frame(pads, bg=C["bg"])
        sci.grid(row=0, column=0, sticky="nsew", padx=(0, 6))
        num = tk.Frame(pads, bg=C["bg"])
        num.grid(row=0, column=1, sticky="nsew")

        self.sci_buttons = []  # (button, spec)
        for r, row in enumerate(SCI_KEYS):
            sci.rowconfigure(r, weight=1, uniform="row")
            for c, spec in enumerate(row):
                sci.columnconfigure(c, weight=1, uniform="col")
                label, action = spec[0], spec[1]
                tip = spec[4] if len(spec) > 4 else None
                kind = "op" if r == 0 and action.startswith("@") else "fn"
                b = FlatButton(sci, label, lambda s=spec: self._press_sci(s),
                               kind=kind, font=self.f_btn, sub=tip)
                b.grid(row=r, column=c, sticky="nsew", padx=2, pady=2)
                self.sci_buttons.append((b, spec))
                if action == "@2nd":
                    self.btn_2nd = b
                elif action == "@angle":
                    self.btn_angle = b
                elif action == "@disp":
                    self.btn_disp = b

        for r, row in enumerate(NUM_KEYS):
            num.rowconfigure(r, weight=1, uniform="row")
            for c, spec in enumerate(row):
                num.columnconfigure(c, weight=1, uniform="col")
                label, action = spec[0], spec[1]
                kind = spec[2] if len(spec) > 2 else "num"
                font = self.f_btn_num if kind in ("num", "op", "eq") else self.f_btn
                b = FlatButton(num, label, lambda a=action: self._press(a), kind=kind, font=font)
                b.grid(row=r, column=c, sticky="nsew", padx=2, pady=2)

        # --- 기록 패널
        side = tk.Frame(root, bg=C["panel"])
        side.grid(row=0, column=1, sticky="nsew", padx=(5, 10), pady=10)
        side.rowconfigure(1, weight=1)
        side.columnconfigure(0, weight=1)
        head = tk.Frame(side, bg=C["panel"])
        head.grid(row=0, column=0, sticky="ew", padx=8, pady=(8, 4))
        tk.Label(head, text="계산 기록", bg=C["panel"], fg=C["text"],
                 font=self.f_btn).pack(side="left")
        clr = tk.Label(head, text="지우기", bg=C["panel"], fg=C["muted"],
                       font=self.f_small, cursor="hand2")
        clr.pack(side="right")
        clr.bind("<Button-1>", lambda e: self._clear_history())

        lb_frame = tk.Frame(side, bg=C["panel"])
        lb_frame.grid(row=1, column=0, sticky="nsew", padx=8)
        lb_frame.rowconfigure(0, weight=1)
        lb_frame.columnconfigure(0, weight=1)
        self.hist_list = tk.Listbox(lb_frame, bg=C["panel"], fg=C["text"], font=self.f_hist,
                                    selectbackground=C["num_hover"], relief="flat",
                                    highlightthickness=0, activestyle="none")
        self.hist_list.grid(row=0, column=0, sticky="nsew")
        sb = tk.Scrollbar(lb_frame, command=self.hist_list.yview)
        sb.grid(row=0, column=1, sticky="ns")
        self.hist_list.config(yscrollcommand=sb.set)
        self.hist_list.bind("<Double-Button-1>", self._history_pick)
        self.hist_list.bind("<Return>", self._history_pick)

        tk.Label(side, text="더블클릭: 수식 불러오기", bg=C["panel"], fg=C["muted"],
                 font=self.f_small).grid(row=2, column=0, sticky="w", padx=8)

        tk.Label(side, text="변수", bg=C["panel"], fg=C["text"],
                 font=self.f_btn).grid(row=3, column=0, sticky="w", padx=8, pady=(10, 2))
        self.vars_var = tk.StringVar()
        tk.Label(side, textvariable=self.vars_var, bg=C["panel"], fg=C["muted"],
                 font=self.f_hist, justify="left", anchor="nw").grid(
            row=4, column=0, sticky="ew", padx=8, pady=(0, 8))

    def _bind_keys(self):
        e = self.entry
        e.bind("<Return>", lambda ev: self._evaluate() or "break")
        e.bind("<KP_Enter>", lambda ev: self._evaluate() or "break")
        e.bind("<Escape>", lambda ev: self._clear() or "break")
        e.bind("<Up>", lambda ev: self._history_nav(-1) or "break")
        e.bind("<Down>", lambda ev: self._history_nav(1) or "break")
        e.bind("<KeyPress>", self._on_keypress)
        self.root.bind("<Control-C>", lambda ev: self._copy_result())  # Ctrl+Shift+C
        self.root.bind("<F1>", lambda ev: self._show_help())
        self.root.bind("<F2>", lambda ev: self._toggle_second())
        self.root.bind("<F3>", lambda ev: self._cycle_angle())
        self.root.bind("<F4>", lambda ev: self._cycle_disp())

    # -------------------------------------------------------------- 입력 처리
    def _on_keypress(self, ev):
        ch = ev.char
        if not ch or not self.just_evaluated:
            return None
        # 계산 직후: 연산자면 Ans에 이어서, 숫자/문자면 새 수식
        if ch in "+-*/^!%×÷":
            self.expr_var.set("Ans")
            self.entry.icursor("end")
        elif ch.isalnum() or ch in ".(√π":
            self.expr_var.set("")
        self.just_evaluated = False
        return None

    def _insert(self, text):
        if self.just_evaluated:
            if text and text[0] in "+-×÷^!%" or text.startswith("^"):
                self.expr_var.set("Ans")
            else:
                self.expr_var.set("")
            self.just_evaluated = False
            self.entry.icursor("end")
        # 선택 영역이 있으면 대체
        try:
            if self.entry.selection_present():
                self.entry.delete("sel.first", "sel.last")
        except tk.TclError:
            pass
        self.entry.insert("insert", text)
        self.entry.focus_set()
        self.entry.xview_moveto(1.0)

    def _press_sci(self, spec):
        action = spec[1]
        if self.second and len(spec) > 3:
            action = spec[3]
        if self.second and not action.startswith("@"):
            self._toggle_second(False)
        self._press(action)

    def _press(self, action):
        if action.startswith("@"):
            {
                "@2nd": self._toggle_second,
                "@angle": self._cycle_angle,
                "@disp": self._cycle_disp,
                "@clear": self._clear,
                "@back": self._backspace,
                "@eval": self._evaluate,
                "@mc": self._mem_clear,
                "@mr": self._mem_recall,
                "@m+": lambda: self._mem_add(1),
                "@m-": lambda: self._mem_add(-1),
            }[action]()
            self.entry.focus_set()
            return
        self._insert(action)

    def _backspace(self):
        if self.just_evaluated:
            self.just_evaluated = False
        try:
            if self.entry.selection_present():
                self.entry.delete("sel.first", "sel.last")
                return
        except tk.TclError:
            pass
        pos = self.entry.index("insert")
        if pos > 0:
            self.entry.delete(pos - 1)

    def _clear(self):
        self.expr_var.set("")
        self.result_var.set("0")
        self.base_var.set("")
        self.lbl_result.config(fg=C["text"])
        self.just_evaluated = False
        self.hist_index = None

    def _on_expr_change(self):
        """입력 중 미리보기 (Ans는 갱신하지 않음)."""
        if self.just_evaluated:
            return
        text = self.expr_var.get().strip()
        if not text:
            self.result_var.set("0")
            self.lbl_result.config(fg=C["muted"])
            self.base_var.set("")
            return
        if "=" in text or "rand" in text:
            return
        try:
            v = self.calc.evaluate(text, store_ans=False)
        except (CalcError, RecursionError):
            return
        self.result_var.set(self._fmt(v))
        self.lbl_result.config(fg=C["muted"])
        self.base_var.set("")

    def _fmt(self, v):
        digits = self.fix_digits if self.display_mode == "FIX" else 10
        return format_number(v, self.display_mode, digits)

    def _evaluate(self):
        text = self.expr_var.get().strip()
        if not text:
            return
        if self.just_evaluated and self.history:
            return
        try:
            v = self.calc.evaluate(text)
        except RecursionError:
            self._show_error("수식이 너무 복잡합니다")
            return
        except CalcError as exc:
            self._show_error(str(exc))
            return
        self.last_result = v
        shown = self._fmt(v)
        self.result_var.set(shown)
        self.lbl_result.config(fg=C["text"])
        self._show_bases(v)
        self.history.append((text, shown))
        self.history = self.history[-MAX_HISTORY:]
        self.hist_index = None
        self.just_evaluated = True
        self._refresh_history()
        self._refresh_vars()
        self.entry.icursor("end")

    def _show_error(self, msg):
        self.result_var.set(msg)
        self.lbl_result.config(fg=C["error"])
        self.base_var.set("")
        self.root.bell()

    def _show_bases(self, v):
        if (isinstance(v, int) or (isinstance(v, float) and v.is_integer() and abs(v) < 2**63)) \
                and abs(v) < 2**64:
            v = int(v)
            self.base_var.set(f"HEX {to_base(v, 16)}   OCT {to_base(v, 8)}   BIN {to_base(v, 2)}"
                              if abs(v) < 2**32 else f"HEX {to_base(v, 16)}")
        else:
            self.base_var.set("")

    # ------------------------------------------------------------- 모드 전환
    def _toggle_second(self, state=None):
        self.second = (not self.second) if state is None else state
        for b, spec in self.sci_buttons:
            if len(spec) > 3:
                b.config(text=spec[2] if self.second else spec[0])
        self.btn_2nd.set_colors(C["toggle_on"] if self.second else C["op"],
                                C["toggle_on"] if self.second else C["op_hover"])
        self._refresh_status()

    def _cycle_angle(self):
        i = ANGLE_MODES.index(self.calc.angle_mode)
        self._set_angle(ANGLE_MODES[(i + 1) % len(ANGLE_MODES)])

    def _set_angle(self, a):
        self.calc.angle_mode = a
        self.var_angle.set(a)
        self._refresh_status()
        self._on_expr_change()

    def _cycle_disp(self):
        i = DISPLAY_MODES.index(self.display_mode)
        self._set_disp(DISPLAY_MODES[(i + 1) % len(DISPLAY_MODES)])

    def _set_disp(self, d):
        self.display_mode = d
        self.var_disp.set(d)
        self._refresh_status()
        self._reformat()

    def _set_fix(self, n):
        self.fix_digits = n
        self._refresh_status()
        self._reformat()

    def _reformat(self):
        if self.just_evaluated and self.last_result is not None:
            self.result_var.set(self._fmt(self.last_result))
        else:
            self._on_expr_change()

    def _refresh_status(self):
        self.lbl_angle.config(text=self.calc.angle_mode)
        disp = self.display_mode + (f" {self.fix_digits}" if self.display_mode == "FIX" else "")
        self.lbl_disp.config(text=disp)
        self.lbl_2nd.config(text="2nd" if self.second else "")
        self.lbl_mem.config(text=f"M = {format_number(self.memory)}" if self.memory else "")
        if hasattr(self, "btn_angle"):
            self.btn_angle.config(text=self.calc.angle_mode)
            self.btn_disp.config(text=self.display_mode)

    # ---------------------------------------------------------------- 메모리
    def _current_value(self):
        text = self.expr_var.get().strip()
        if not text:
            return self.last_result if self.last_result is not None else 0
        if self.just_evaluated and self.last_result is not None:
            return self.last_result
        try:
            return self.calc.evaluate(text, store_ans=False)
        except CalcError as exc:
            self._show_error(str(exc))
            return None

    def _mem_add(self, sign):
        v = self._current_value()
        if v is None:
            return
        self.memory = self.memory + sign * v
        self._refresh_status()

    def _mem_clear(self):
        self.memory = 0
        self._refresh_status()

    def _mem_recall(self):
        m = self.memory
        text = str(m) if isinstance(m, int) else repr(m)
        if text.startswith("-"):
            text = f"({text})"
        self._insert(text)

    # ---------------------------------------------------------------- 기록
    def _refresh_history(self):
        self.hist_list.delete(0, "end")
        for expr, res in self.history:
            self.hist_list.insert("end", f"{expr}")
            self.hist_list.insert("end", f"   = {res}")
            self.hist_list.itemconfig("end", fg=C["accent"])
        self.hist_list.see("end")

    def _refresh_vars(self):
        vs = self.calc.variables
        self.vars_var.set("\n".join(f"{k} = {format_number(v)}" for k, v in vs.items())
                          or "(없음)  예: x = 5")

    def _history_pick(self, _=None):
        sel = self.hist_list.curselection()
        if not sel:
            return
        idx = sel[0] // 2
        expr, res = self.history[idx]
        if sel[0] % 2 == 1:
            # 결과 줄 선택: 결과값 삽입
            self._insert(f"({res})" if ("E" in res or res.startswith("-")) else res)
        else:
            self.just_evaluated = False
            self.expr_var.set(expr)
            self.entry.icursor("end")
        self.entry.focus_set()

    def _history_nav(self, step):
        if not self.history:
            return
        if self.hist_index is None:
            self.hist_index = len(self.history)
        self.hist_index = max(0, min(len(self.history), self.hist_index + step))
        self.just_evaluated = False
        if self.hist_index == len(self.history):
            self.expr_var.set("")
        else:
            self.expr_var.set(self.history[self.hist_index][0])
        self.entry.icursor("end")

    def _clear_history(self):
        self.history.clear()
        self._refresh_history()

    # ---------------------------------------------------------------- 기타
    def _copy_result(self):
        self.root.clipboard_clear()
        self.root.clipboard_append(self.result_var.get())

    def _copy_expr(self):
        self.root.clipboard_clear()
        self.root.clipboard_append(self.expr_var.get())

    def _show_help(self):
        win = tk.Toplevel(self.root)
        win.title("사용법")
        win.configure(bg=C["panel"])
        txt = tk.Text(win, bg=C["panel"], fg=C["text"], font=self.f_hist, relief="flat",
                      width=64, height=32, padx=12, pady=12, wrap="word")
        txt.insert("1.0", HELP_TEXT)
        txt.config(state="disabled")
        txt.pack(fill="both", expand=True)
        win.transient(self.root)

    def _load_state(self):
        try:
            data = json.loads(STATE_FILE.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return
        if data.get("angle") in ANGLE_MODES:
            self.calc.angle_mode = data["angle"]
        if data.get("display") in DISPLAY_MODES:
            self.display_mode = data["display"]
        if isinstance(data.get("fix"), int):
            self.fix_digits = max(0, min(10, data["fix"]))
        if isinstance(data.get("memory"), (int, float)):
            self.memory = data["memory"]
        hist = data.get("history")
        if isinstance(hist, list):
            self.history = [tuple(h) for h in hist if isinstance(h, list) and len(h) == 2][-MAX_HISTORY:]
        variables = data.get("variables")
        if isinstance(variables, dict):
            self.calc.variables = {k: v for k, v in variables.items()
                                   if isinstance(k, str) and k.isidentifier()
                                   and isinstance(v, (int, float))}
        if isinstance(data.get("ans"), (int, float)):
            self.calc.ans = data["ans"]

    def _save_state(self):
        data = {
            "angle": self.calc.angle_mode,
            "display": self.display_mode,
            "fix": self.fix_digits,
            "memory": self.memory if abs(self.memory) < 1e300 else 0,
            "history": self.history[-MAX_HISTORY:],
            "variables": {k: v for k, v in self.calc.variables.items()
                          if isinstance(v, float) or abs(v) < 10**300},
            "ans": self.calc.ans if isinstance(self.calc.ans, float) or abs(self.calc.ans) < 10**300 else 0,
        }
        try:
            STATE_FILE.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
        except (OSError, TypeError, ValueError):
            pass

    def _on_close(self):
        self._save_state()
        self.root.destroy()


def main():
    if sys.platform == "win32":
        try:  # 고해상도 모니터에서 흐릿하게 보이지 않도록
            import ctypes
            ctypes.windll.shcore.SetProcessDpiAwareness(1)
        except Exception:
            pass
    root = tk.Tk()
    app = EngCalcApp(root)
    app._refresh_vars()
    root.mainloop()


if __name__ == "__main__":
    main()
