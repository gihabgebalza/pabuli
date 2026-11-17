# 공학계산기 (Engineering Calculator)

Python 표준 라이브러리(Tkinter)만으로 만든 데스크탑 공학계산기입니다.
Windows / macOS / Linux에서 추가 설치 없이 실행됩니다.

## 실행

```bash
python engcalc.py        # Windows에서는 pythonw engcalc.py 로 콘솔 창 없이 실행
```

> Linux에서 `No module named 'tkinter'` 오류가 나면 `sudo apt install python3-tk` 를 설치하세요.

### 단일 실행 파일(.exe) 만들기 (선택)

```bash
pip install pyinstaller
pyinstaller --onefile --windowed --name 공학계산기 engcalc.py
# dist/ 폴더에 실행 파일이 생성됩니다
```

## 기능

- **수식 입력**: 키보드로 직접 입력하거나 버튼 클릭. 입력하는 동안 결과 미리보기
- **연산**: `+ − × ÷`, `^` 거듭제곱, `!` 팩토리얼, `%`, 괄호, 지수 표기(`6.02E23`)
- **암시적 곱셈**: `2π`, `3(4+5)`, `2sin(30)`
- **함수**: 삼각/역삼각, 쌍곡선, `ln log log2 exp`, `√ ∛ root(x,n)`, `nPr nCr`, `gcd lcm mod abs`,
  `floor ceil round hypot rand` — `log(x, 밑)` 으로 임의 밑 로그
- **각도 단위**: DEG / RAD / GRAD
- **표시 형식**: NORM / SCI(과학) / ENG(공학, 지수 3의 배수) / FIX(소수 고정, 자릿수 선택)
- **2nd 키**: 버튼의 보조 기능 (역삼각함수, eˣ, 10ˣ 등)
- **Ans / 변수**: 직전 결과 `Ans`, `x = 3*4` 처럼 변수 저장 후 `2x+1` 로 사용
- **메모리**: MC / MR / M+ / M−
- **진법 표시**: 정수 결과는 HEX / OCT / BIN 동시 표시
- **계산 기록**: 더블클릭으로 수식 재사용, ↑/↓ 키로 탐색
- 설정·기록·변수는 `~/.engcalc_state.json` 에 자동 저장

## 단축키

| 키 | 동작 |
|---|---|
| Enter | 계산 |
| Esc | 지우기 |
| ↑ / ↓ | 이전 / 다음 수식 |
| F1 | 사용법 |
| F2 | 2nd 전환 |
| F3 | 각도 단위 전환 |
| F4 | 표시 형식 전환 |
| Ctrl+Shift+C | 결과 복사 |

## 파일 구성

- `engcalc.py` — GUI
- `calc_engine.py` — 수식 파서/계산 엔진 (`eval` 미사용, GUI와 독립)
- `tests/` — 엔진 단위 테스트 (`python -m unittest discover -s tests -t .`)
