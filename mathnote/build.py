"""engine.js 를 app.src.html 안에 넣어 한 파일짜리 mathnote.html 을 만든다.

실행: python mathnote/build.py
"""
from pathlib import Path

here = Path(__file__).resolve().parent
src = (here / "app.src.html").read_text(encoding="utf-8")
engine = (here / "engine.js").read_text(encoding="utf-8")
marker = "/*@@ENGINE@@*/"
assert src.count(marker) == 1, "엔진 삽입 위치를 찾을 수 없습니다"
assert "</script" not in engine, "엔진 코드에 </script 가 있으면 안 됩니다"
out = here.parent / "mathnote.html"
out.write_text(src.replace(marker, engine), encoding="utf-8")
print(f"생성됨: {out}")
