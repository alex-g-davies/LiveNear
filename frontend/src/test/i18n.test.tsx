// Spec 028: language choice, catalogue completeness and formats.
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";

import EnglishText from "../components/EnglishText";
import LanguagePicker from "../components/LanguagePicker";
import Landing from "../components/Landing";
import { formatDate, formatMonths } from "../cars/lib/format";
import { optionLabel } from "../cars/lib/optionLabel";
import { displayLabel, inputLabel, itemLabel, materialLabel } from "../i18n/backendLabels";
import { detectLang, dropLangParam, getLang, resetLanguage, setLanguage, STORAGE_KEY, t } from "../i18n/core";
import en from "../i18n/en";
import nb from "../i18n/nb";
import tr from "../i18n/tr";

const NB = " ";

// This jsdom build has no usable localStorage, so give each test its own.
beforeEach(() => {
  const store = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  });
});

afterEach(() => {
  cleanup();
  resetLanguage();
  vi.unstubAllGlobals();
});

describe("starting language (R2)", () => {
  it("prefers the stored choice, then ?lang=, then the browser, then English", () => {
    expect(detectLang("tr", "?lang=nb", ["nb-NO"])).toBe("tr");
    expect(detectLang(null, "?lang=nb", ["tr-TR"])).toBe("nb");
    expect(detectLang("xx", "?lang=zz", ["tr-TR"])).toBe("tr");
    expect(detectLang(null, "", ["nn-NO"])).toBe("nb");
    expect(detectLang(null, "", ["no"])).toBe("nb");
    expect(detectLang(null, "", ["de-DE", "nb"])).toBe("nb");
    expect(detectLang(null, "", ["de-DE", "fr"])).toBe("en");
    expect(detectLang(null, "", [])).toBe("en");
  });
});

describe("share links (R4)", () => {
  it("drops ?lang= from the address bar and keeps everything else", () => {
    window.history.replaceState(null, "", "/drive-cheap?c=abc&lang=nb#top");
    dropLangParam();
    expect(`${window.location.pathname}${window.location.search}${window.location.hash}`).toBe("/drive-cheap?c=abc#top");
    window.history.replaceState(null, "", "/");
  });
});

describe("catalogues (R13)", () => {
  const placeholders = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join(",");

  for (const [name, dict] of [["nb", nb], ["tr", tr]] as const) {
    it(`${name} defines every English key, with the same placeholders`, () => {
      const enDict = en as Record<string, string>;
      const other = dict as Record<string, string>;
      for (const key of Object.keys(enDict)) {
        expect(other[key], `${name} is missing ${key}`).toBeTypeOf("string");
        expect(other[key].trim(), `${name} ${key} is empty`).not.toBe("");
        expect(placeholders(other[key]), `${name} ${key} placeholders`).toBe(placeholders(enDict[key]));
      }
      expect(Object.keys(other).filter((k) => !(k in enDict))).toEqual([]);
    });
  }
});

describe("translate", () => {
  it("fills placeholders and picks plural forms", async () => {
    expect(t("common.years", { count: 1, value: "1" })).toBe("1 year");
    expect(t("common.years", { count: 2.5, value: "2.5" })).toBe("2.5 years");
    await act(() => setLanguage("nb", false));
    expect(t("common.months", { count: 1, value: "1" })).toBe("1 måned");
    expect(t("common.months", { count: 6, value: "6" })).toBe("6 måneder");
  });
});

describe("switching (R1, R3, R12)", () => {
  it("re-renders in the new language, stores the choice and sets <html lang>", async () => {
    render(
      <MemoryRouter>
        <Landing />
      </MemoryRouter>,
    );
    expect(screen.getByText(/Weigh up where to live/)).toBeInTheDocument();
    const picker = screen.getByRole("combobox", { name: "Language: English" });
    expect(screen.getByText("EN")).toBeInTheDocument();
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual(["English", "Norsk (bokmål)", "Türkçe"]);

    await act(async () => {
      fireEvent.change(picker, { target: { value: "nb" } });
      await new Promise((r) => setTimeout(r, 0));
    });
    await screen.findByText(/Vurder hvor du vil bo/);
    expect(screen.getByRole("combobox", { name: "Språk: Norsk (bokmål)" })).toBeInTheDocument();
    expect(screen.getByText("NB")).toBeInTheDocument();
    expect(document.documentElement.lang).toBe("nb-NO");
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe("nb");
    expect(getLang()).toBe("nb");
  });

  it("does not store a language it only detected", async () => {
    await act(() => setLanguage("tr", false));
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(document.documentElement.lang).toBe("tr-TR");
  });

  it("renders the picker with no setup in English", () => {
    render(<LanguagePicker />);
    expect(screen.getByRole("combobox")).toHaveValue("en");
  });
});

describe("English prose (R7)", () => {
  it("is plain in English and tagged elsewhere", async () => {
    const { container, rerender } = render(<EnglishText>Rule note</EnglishText>);
    expect(container.querySelector("[lang]")).toBeNull();
    expect(container.textContent).toBe("Rule note");
    await act(() => setLanguage("tr", false));
    rerender(<EnglishText>Rule note</EnglishText>);
    expect(container.querySelector('[lang="en"]')).not.toBeNull();
    expect(container.textContent).toBe("Rule note (İngilizce)");
  });
});

describe("keyed backend labels (R6)", () => {
  it("translates by key and falls back to the English label", async () => {
    expect(displayLabel("value_lost", "Value lost")).toBe("Value lost");
    await act(() => setLanguage("nb", false));
    expect(displayLabel("value_lost", "Value lost")).toBe("Verditap");
    expect(itemLabel("traffic_tax", "Traffic insurance tax")).toBe("Trafikkforsikringsavgift");
    expect(inputLabel("options.tesla.loan_rate", "Loan rate")).toBe("Lånerente");
    expect(inputLabel("rules.traffic_tax_2026", "Traffic insurance tax rule")).toBe("Regel for trafikkforsikringsavgift");
    expect(materialLabel("item:tyres", "Tyres")).toBe("Dekk");
    expect(displayLabel("brand_new_line", "Brand new line")).toBe("Brand new line");
    expect(inputLabel("x.something_unknown", "Something unknown")).toBe("Something unknown");
  });
});

describe("dates and durations (R11)", () => {
  it("follow the language", async () => {
    expect(formatDate("2027-01-01")).toBe(`1${NB}Jan${NB}2027`);
    expect(formatMonths(30)).toBe("2.5 years");
    await act(() => setLanguage("nb", false));
    expect(formatDate("2027-01-01")).toBe(`1.${NB}jan.${NB}2027`);
    expect(formatDate("2026-05-17")).toBe(`17.${NB}mai${NB}2026`);
    expect(formatMonths(30)).toBe("2,5 år");
    expect(formatMonths(6)).toBe("6 måneder");
    await act(() => setLanguage("tr", false));
    expect(formatDate("2026-08-06")).toBe(`6${NB}Ağu${NB}2026`);
    expect(formatMonths(12)).toBe("1 yıl");
  });
});

describe("option names (R5)", () => {
  it("keep the car and translate how you get it", async () => {
    const used = "Tesla Model 3 RWD 2021, used from a private seller";
    expect(optionLabel(used)).toBe(used);
    await act(() => setLanguage("nb", false));
    expect(optionLabel(used)).toBe("Tesla Model 3 RWD 2021, brukt fra privat selger");
    expect(optionLabel("Tesla Model Y 2023, 36-month lease")).toBe("Tesla Model Y 2023, leasing i 36 måneder");
    await act(() => setLanguage("tr", false));
    expect(optionLabel("Tesla Model 3 RWD (Highland) 2026, buy new")).toBe("Tesla Model 3 RWD (Highland) 2026, sıfır satın alma");
    expect(optionLabel("Tesla Model 3 RWD 2023, used from a dealer")).toBe("Tesla Model 3 RWD 2023, bayiden ikinci el");
    expect(optionLabel("Something else")).toBe("Something else");
  });
});
