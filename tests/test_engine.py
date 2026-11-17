import math
import unittest

from calc_engine import Calculator, CalcError, format_number, to_base


class EngineTest(unittest.TestCase):
    def setUp(self):
        self.c = Calculator()

    def ev(self, s):
        return self.c.evaluate(s)

    def test_basic(self):
        cases = {
            "1+2*3": 7, "(1+2)*3": 9, "10/4": 2.5, "10/5": 2, "2^10": 1024,
            "2^3^2": 512, "-2^2": -4, "(-2)^2": 4, "2^-1": 0.5, "5!": 120,
            "50%": 0.5, "3×4÷2": 6, "2**3": 8, "1.5e3": 1500, "7−2": 5,
        }
        for expr, want in cases.items():
            with self.subTest(expr=expr):
                self.assertAlmostEqual(self.ev(expr), want)

    def test_implicit_mult(self):
        self.assertAlmostEqual(self.ev("2pi"), 2 * math.pi)
        self.assertEqual(self.ev("3(4+5)"), 27)
        self.assertEqual(self.ev("(1+2)(3+4)"), 21)
        self.assertAlmostEqual(self.ev("2e"), 2 * math.e)
        self.assertAlmostEqual(self.ev("2sin(30)"), 1)

    def test_trig_modes(self):
        self.assertAlmostEqual(self.ev("sin(30)"), 0.5)
        self.assertEqual(self.ev("sin(180)"), 0)
        self.assertAlmostEqual(self.ev("asin(1)"), 90)
        self.c.angle_mode = "RAD"
        self.assertAlmostEqual(self.ev("cos(pi)"), -1)
        self.c.angle_mode = "GRAD"
        self.assertAlmostEqual(self.ev("sin(100)"), 1)
        self.c.angle_mode = "DEG"
        with self.assertRaises(CalcError):
            self.ev("tan(90)")

    def test_functions(self):
        self.assertEqual(self.ev("sqrt(16)"), 4)
        self.assertEqual(self.ev("√16"), 4)
        self.assertEqual(self.ev("2√9"), 6)
        self.assertEqual(self.ev("cbrt(-27)"), -3)
        self.assertAlmostEqual(self.ev("log(1000)"), 3)
        self.assertAlmostEqual(self.ev("log(8,2)"), 3)
        self.assertAlmostEqual(self.ev("ln(e)"), 1)
        self.assertEqual(self.ev("nCr(5,2)"), 10)
        self.assertEqual(self.ev("nPr(5,2)"), 20)
        self.assertEqual(self.ev("gcd(12,18)"), 6)
        self.assertEqual(self.ev("mod(10,3)"), 1)
        self.assertAlmostEqual(self.ev("(-8)^(1/3)"), -2)
        self.assertAlmostEqual(self.ev("root(32,5)"), 2)
        self.assertAlmostEqual(self.ev("sin 30"), 0.5)

    def test_ans_and_vars(self):
        self.ev("3+4")
        self.assertEqual(self.ev("Ans*2"), 14)
        self.ev("x = 5")
        self.assertEqual(self.ev("2x+1"), 11)

    def test_errors(self):
        for bad in ["1/0", "sqrt(-1)", "ln(0)", "1+", "(1+2))", "foo(2)", "2$3",
                    "asin(2)", "", "(-1)!", "(-2)^0.5"]:
            with self.subTest(expr=bad):
                with self.assertRaises(CalcError):
                    self.ev(bad)

    def test_unclosed_paren_ok(self):
        self.assertEqual(self.ev("(1+2"), 3)
        self.assertAlmostEqual(self.ev("sin(30"), 0.5)

    def test_format(self):
        self.assertEqual(format_number(0.1 + 0.2), "0.3")
        self.assertEqual(format_number(12345), "12345")
        self.assertEqual(format_number(1e20), "1E20")
        self.assertEqual(format_number(1.5e-12), "1.5E-12")
        self.assertEqual(format_number(12345.678, "SCI"), "1.2345678E4")
        self.assertEqual(format_number(12345.678, "ENG"), "12.345678E3")
        self.assertEqual(format_number(0.00047, "ENG"), "470E-6")
        self.assertEqual(format_number(2 / 3, "FIX", 4), "0.6667")
        self.assertEqual(format_number(math.factorial(30)), "2.652528598E32")
        self.assertEqual(to_base(255, 16), "0xFF")
        self.assertEqual(to_base(-5, 2), "-0b101")


if __name__ == "__main__":
    unittest.main()
