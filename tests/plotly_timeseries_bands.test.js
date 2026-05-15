/**
 * @jest-environment jsdom
 *
 * Tests for plotly_timeseries_bands.js
 *
 * Strategy: the viz is a browser IIFE that registers via
 * looker.plugins.visualizations.add(). We mock Looker and Plotly globals,
 * evaluate the file, capture the registered viz definition, then exercise
 * its lifecycle methods (create, updateAsync, _rerender) and verify the
 * arguments passed to Plotly.react / Plotly.relayout.
 */

const fs   = require("fs");
const path = require("path");

// ---------------------------------------------------------------------------
// Globals and mocks — must be set before the IIFE executes
// ---------------------------------------------------------------------------

let capturedViz = null;

// Plotly mock — captures every call so tests can inspect arguments
const mockPlotly = {
  react:    jest.fn().mockResolvedValue(undefined),
  relayout: jest.fn().mockResolvedValue(undefined),
  restyle:  jest.fn().mockResolvedValue(undefined),
};

// Looker mock — captures the viz registration
global.looker = {
  plugins: {
    visualizations: {
      add: jest.fn((def) => { capturedViz = def; }),
    },
  },
};

// Plotly available on window (bypasses the CDN loader)
global.window.Plotly = mockPlotly;
global.Plotly        = mockPlotly;

// Evaluate the IIFE — populates capturedViz via looker.plugins.visualizations.add
const VIZ_CODE = fs.readFileSync(
  path.join(__dirname, "../plotly_timeseries_bands.js"),
  "utf8"
);
// eslint-disable-next-line no-eval
eval(VIZ_CODE);

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/** Shorthand for a Looker queryResponse */
function qr(dims = [], meas = []) {
  return {
    fields: {
      dimensions: dims.map((n) => ({ name: n, label: n, label_short: n })),
      measures:   meas.map((n) => ({ name: n, label: n, label_short: n })),
    },
  };
}

/** Shorthand for a Looker data row */
function row(fields) {
  const r = {};
  Object.entries(fields).forEach(([k, v]) => { r[k] = { value: v }; });
  return r;
}

/** Minimal valid config with one band group */
function cfg(overrides = {}) {
  return {
    x_field:            "ts.time",
    x_axis_label:       "",
    measure_fields:     "readings.power_kw",
    trace_type:         "lines",
    line_width:         2,
    point_size:         4,
    line_opacity:       1.0,
    connect_gaps:       false,
    band_opacity:       0.4,
    band_border:        false,
    use_dual_axis:      false,
    y_axis_label:       "",
    y2_axis_label:      "",
    show_legend:        true,
    chart_theme:        "light",
    legend_position:    "right",
    font_size_axis_title: 12,
    font_size_ticks:    11,
    font_size_legend:   11,
    font_size_hover:    12,
    band_group_1_label: "ODU Status",
    band_group_1_start: "odu.period_start",
    band_group_1_end:   "odu.period_end",
    band_group_1_cat:   "odu.status",
    band_group_1_colors: "",
    band_group_2_label: "",
    band_group_2_start: "",
    band_group_2_end:   "",
    band_group_2_cat:   "",
    band_group_2_colors: "",
    ...overrides,
  };
}

/** Sample data rows covering one ODU event */
function sampleData() {
  return [
    row({ "ts.time": "2026-05-14T12:00:00", "readings.power_kw": 1.2,
          "odu.period_start": "2026-05-14T12:00:00", "odu.period_end": "2026-05-14T13:00:00", "odu.status": "Cooling" }),
    row({ "ts.time": "2026-05-14T12:15:00", "readings.power_kw": 1.4,
          "odu.period_start": "2026-05-14T12:00:00", "odu.period_end": "2026-05-14T13:00:00", "odu.status": "Cooling" }),
    row({ "ts.time": "2026-05-14T13:00:00", "readings.power_kw": 0.8,
          "odu.period_start": "2026-05-14T13:00:00", "odu.period_end": "2026-05-14T14:00:00", "odu.status": "Heating" }),
    row({ "ts.time": "2026-05-14T13:15:00", "readings.power_kw": null,  // null measure
          "odu.period_start": "2026-05-14T13:00:00", "odu.period_end": "2026-05-14T14:00:00", "odu.status": "Heating" }),
    row({ "ts.time": "2026-05-14T14:00:00", "readings.power_kw": 0.5,
          "odu.period_start": null, "odu.period_end": null, "odu.status": null }), // no band
  ];
}

/** Mount a viz instance and return {viz, element, chartDiv} */
function mountViz() {
  const element  = document.createElement("div");
  const viz      = Object.create(capturedViz);

  // Attach Plotly event emitter methods to the chartDiv that will be created
  const origCreate = document.createElement.bind(document);
  jest.spyOn(document, "createElement").mockImplementation((tag) => {
    const el = origCreate(tag);
    el.on                   = jest.fn().mockReturnThis();
    el.removeAllListeners   = jest.fn().mockReturnThis();
    return el;
  });

  capturedViz.create.call(viz, element, {});
  document.createElement.mockRestore();

  return { viz, element, chartDiv: viz._chartDiv };
}

/** Run updateAsync and wait for done() */
async function runUpdate(viz, data, config, queryResponse) {
  return new Promise((resolve) => {
    capturedViz.updateAsync.call(
      viz, data, viz._wrapper || viz._chartDiv, config, queryResponse,
      {}, // details
      resolve
    );
  });
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

beforeEach(() => {
  jest.clearAllMocks();
});

// ============================================================
// 1. Registration
// ============================================================
describe("viz registration", () => {
  test("registers with correct id", () => {
    expect(capturedViz.id).toBe("plotly_timeseries_bands");
  });

  test("registers with correct label", () => {
    expect(capturedViz.label).toBe("Timeseries with Plotbands");
  });

  test("exposes required lifecycle methods", () => {
    expect(typeof capturedViz.create).toBe("function");
    expect(typeof capturedViz.updateAsync).toBe("function");
  });
});

// ============================================================
// 2. Config options structure
// ============================================================
describe("config options", () => {
  const opts = capturedViz.options;

  test("has x_field option", () => {
    expect(opts.x_field).toBeDefined();
    expect(opts.x_field.type).toBe("string");
  });

  test("has x_axis_label display override option", () => {
    expect(opts.x_axis_label).toBeDefined();
    expect(opts.x_axis_label.type).toBe("string");
  });

  test("has band group options for all 5 groups", () => {
    for (let i = 1; i <= 5; i++) {
      expect(opts[`band_group_${i}_label`]).toBeDefined();
      expect(opts[`band_group_${i}_start`]).toBeDefined();
      expect(opts[`band_group_${i}_end`]).toBeDefined();
      expect(opts[`band_group_${i}_cat`]).toBeDefined();
      expect(opts[`band_group_${i}_colors`]).toBeDefined();
    }
  });

  test("chart_theme defaults to light", () => {
    expect(opts.chart_theme.default).toBe("light");
  });

  test("legend_position defaults to right", () => {
    expect(opts.legend_position.default).toBe("right");
  });

  test("connect_gaps defaults to false", () => {
    expect(opts.connect_gaps.default).toBe(false);
  });

  test("has all four font size options", () => {
    expect(opts.font_size_axis_title).toBeDefined();
    expect(opts.font_size_ticks).toBeDefined();
    expect(opts.font_size_legend).toBeDefined();
    expect(opts.font_size_hover).toBeDefined();
  });

  test("band_opacity max is at least 0.8", () => {
    expect(opts.band_opacity.max).toBeGreaterThanOrEqual(0.8);
  });

  test("color overrides option exists per group", () => {
    expect(opts.band_group_1_colors.type).toBe("string");
  });
});

// ============================================================
// 3. create() lifecycle
// ============================================================
describe("create()", () => {
  test("creates wrapper, controlBar, and chartDiv elements", () => {
    const { viz } = mountViz();
    expect(viz._wrapper).toBeDefined();
    expect(viz._controlBar).toBeDefined();
    expect(viz._chartDiv).toBeDefined();
  });

  test("initialises _stickyAnnotations as empty array", () => {
    const { viz } = mountViz();
    expect(viz._stickyAnnotations).toEqual([]);
  });

  test("initialises _activeGroups as empty object", () => {
    const { viz } = mountViz();
    expect(viz._activeGroups).toEqual({});
  });

  test("initialises _renderCache as null", () => {
    const { viz } = mountViz();
    expect(viz._renderCache).toBeNull();
  });
});

// ============================================================
// 4. updateAsync — measure trace building
// ============================================================
describe("updateAsync — measure traces", () => {
  test("calls Plotly.react with a trace per measure", async () => {
    const { viz } = mountViz();
    await runUpdate(viz, sampleData(), cfg(), qr(["ts.time"], ["readings.power_kw"]));
    const [, traces] = mockPlotly.react.mock.calls[0];
    const measureTraces = traces.filter((t) => !t.legendgroup);
    expect(measureTraces).toHaveLength(1);
    expect(measureTraces[0].name).toBe("readings.power_kw");
  });

  test("x values include all non-null timestamp rows", async () => {
    const { viz } = mountViz();
    await runUpdate(viz, sampleData(), cfg(), qr(["ts.time"], ["readings.power_kw"]));
    const [, traces] = mockPlotly.react.mock.calls[0];
    const measureTrace = traces.find((t) => !t.legendgroup);
    expect(measureTrace.x).toHaveLength(5);
  });

  test("null measure values are preserved as null in y array", async () => {
    const { viz } = mountViz();
    await runUpdate(viz, sampleData(), cfg(), qr(["ts.time"], ["readings.power_kw"]));
    const [, traces] = mockPlotly.react.mock.calls[0];
    const measureTrace = traces.find((t) => !t.legendgroup);
    expect(measureTrace.y[3]).toBeNull(); // row 4 has null power_kw
  });

  test("connect_gaps false sets connectgaps to false on traces", async () => {
    const { viz } = mountViz();
    await runUpdate(viz, sampleData(), cfg({ connect_gaps: false }), qr(["ts.time"], ["readings.power_kw"]));
    const [, traces] = mockPlotly.react.mock.calls[0];
    const measureTrace = traces.find((t) => !t.legendgroup);
    expect(measureTrace.connectgaps).toBe(false);
  });

  test("connect_gaps true sets connectgaps to true on traces", async () => {
    const { viz } = mountViz();
    await runUpdate(viz, sampleData(), cfg({ connect_gaps: true }), qr(["ts.time"], ["readings.power_kw"]));
    const [, traces] = mockPlotly.react.mock.calls[0];
    const measureTrace = traces.find((t) => !t.legendgroup);
    expect(measureTrace.connectgaps).toBe(true);
  });

  test("scatter mode uses scattergl type", async () => {
    const { viz } = mountViz();
    await runUpdate(viz, sampleData(), cfg({ trace_type: "markers" }), qr(["ts.time"], ["readings.power_kw"]));
    const [, traces] = mockPlotly.react.mock.calls[0];
    const measureTrace = traces.find((t) => !t.legendgroup);
    expect(measureTrace.type).toBe("scattergl");
  });

  test("lines mode uses scatter type", async () => {
    const { viz } = mountViz();
    await runUpdate(viz, sampleData(), cfg({ trace_type: "lines" }), qr(["ts.time"], ["readings.power_kw"]));
    const [, traces] = mockPlotly.react.mock.calls[0];
    const measureTrace = traces.find((t) => !t.legendgroup);
    expect(measureTrace.type).toBe("scatter");
    expect(measureTrace.mode).toBe("lines");
  });

  test("dual axis puts second measure on y2", async () => {
    const data = sampleData().map((r) => ({
      ...r,
      "readings.temp_f": { value: 72 },
    }));
    const { viz } = mountViz();
    await runUpdate(
      viz, data,
      cfg({ measure_fields: "readings.power_kw, readings.temp_f", use_dual_axis: true }),
      qr(["ts.time"], ["readings.power_kw", "readings.temp_f"])
    );
    const [, traces] = mockPlotly.react.mock.calls[0];
    const measureTraces = traces.filter((t) => !t.legendgroup);
    expect(measureTraces[0].yaxis).toBe("y");
    expect(measureTraces[1].yaxis).toBe("y2");
  });

  test("auto-detects first dimension as x when x_field is blank", async () => {
    const { viz } = mountViz();
    await runUpdate(
      viz, sampleData(),
      cfg({ x_field: "" }),
      qr(["ts.time"], ["readings.power_kw"])
    );
    expect(mockPlotly.react).toHaveBeenCalled();
    const [, traces] = mockPlotly.react.mock.calls[0];
    expect(traces.find((t) => !t.legendgroup).x[0]).toBe("2026-05-14T12:00:00");
  });
});

// ============================================================
// 5. updateAsync — band groups
// ============================================================
describe("updateAsync — band groups", () => {
  test("band dummy traces added for each unique category", async () => {
    const { viz } = mountViz();
    await runUpdate(viz, sampleData(), cfg(), qr(["ts.time"], ["readings.power_kw"]));
    const [, traces] = mockPlotly.react.mock.calls[0];
    const bandTraces = traces.filter((t) => t.legendgroup === "bg_0");
    const names = bandTraces.map((t) => t.name).sort();
    expect(names).toEqual(["Cooling", "Heating"]);
  });

  test("shapes built for each unique band period", async () => {
    const { viz } = mountViz();
    await runUpdate(viz, sampleData(), cfg(), qr(["ts.time"], ["readings.power_kw"]));
    const [,, layout] = mockPlotly.react.mock.calls[0];
    expect(layout.shapes).toHaveLength(2); // Cooling + Heating shapes
  });

  test("shapes have correct x0/x1 from band timestamps", async () => {
    const { viz } = mountViz();
    await runUpdate(viz, sampleData(), cfg(), qr(["ts.time"], ["readings.power_kw"]));
    const [,, layout] = mockPlotly.react.mock.calls[0];
    const cooling = layout.shapes.find((s) => s.x0 === "2026-05-14T12:00:00");
    expect(cooling).toBeDefined();
    expect(cooling.x1).toBe("2026-05-14T13:00:00");
  });

  test("rows with null band fields produce no shape", async () => {
    // Row 5 has null odu fields — should still be only 2 shapes
    const { viz } = mountViz();
    await runUpdate(viz, sampleData(), cfg(), qr(["ts.time"], ["readings.power_kw"]));
    const [,, layout] = mockPlotly.react.mock.calls[0];
    expect(layout.shapes).toHaveLength(2);
  });

  test("shapes span full paper height (y0=0, y1=1)", async () => {
    const { viz } = mountViz();
    await runUpdate(viz, sampleData(), cfg(), qr(["ts.time"], ["readings.power_kw"]));
    const [,, layout] = mockPlotly.react.mock.calls[0];
    layout.shapes.forEach((s) => {
      expect(s.y0).toBe(0);
      expect(s.y1).toBe(1);
      expect(s.yref).toBe("paper");
    });
  });

  test("unconfigured band groups (missing fields) are skipped", async () => {
    const { viz } = mountViz();
    await runUpdate(
      viz, sampleData(),
      cfg({ band_group_1_label: "", band_group_1_start: "", band_group_1_end: "", band_group_1_cat: "" }),
      qr(["ts.time"], ["readings.power_kw"])
    );
    const [, traces] = mockPlotly.react.mock.calls[0];
    const bandTraces = traces.filter((t) => t.legendgroup && t.legendgroup.startsWith("bg_"));
    expect(bandTraces).toHaveLength(0);
  });

  test("band_opacity applied to shape fillcolor", async () => {
    const { viz } = mountViz();
    await runUpdate(viz, sampleData(), cfg({ band_opacity: 0.5 }), qr(["ts.time"], ["readings.power_kw"]));
    const [,, layout] = mockPlotly.react.mock.calls[0];
    expect(layout.shapes[0].fillcolor).toContain("0.5)");
  });

  test("band legendgrouptitle matches group label", async () => {
    const { viz } = mountViz();
    await runUpdate(viz, sampleData(), cfg(), qr(["ts.time"], ["readings.power_kw"]));
    const [, traces] = mockPlotly.react.mock.calls[0];
    const bandTrace = traces.find((t) => t.legendgroup === "bg_0");
    expect(bandTrace.legendgrouptitle.text).toBe("ODU Status");
  });
});

// ============================================================
// 6. Color overrides
// ============================================================
describe("color overrides", () => {
  test("valid JSON color override applied to dummy trace marker", async () => {
    const { viz } = mountViz();
    await runUpdate(
      viz, sampleData(),
      cfg({ band_group_1_colors: '{"Cooling":"#ff0000"}' }),
      qr(["ts.time"], ["readings.power_kw"])
    );
    const [, traces] = mockPlotly.react.mock.calls[0];
    const coolingTrace = traces.find((t) => t.legendgroup === "bg_0" && t.name === "Cooling");
    expect(coolingTrace.marker.color).toContain("rgba(255,0,0,");
  });

  test("invalid JSON falls back to palette (no throw)", async () => {
    const { viz } = mountViz();
    await expect(
      runUpdate(
        viz, sampleData(),
        cfg({ band_group_1_colors: "not-json" }),
        qr(["ts.time"], ["readings.power_kw"])
      )
    ).resolves.toBeUndefined();
    expect(mockPlotly.react).toHaveBeenCalled();
  });

  test("hex shorthand (#rgb) converted correctly", async () => {
    const { viz } = mountViz();
    await runUpdate(
      viz, sampleData(),
      cfg({ band_group_1_colors: '{"Cooling":"#f00"}' }),
      qr(["ts.time"], ["readings.power_kw"])
    );
    const [, traces] = mockPlotly.react.mock.calls[0];
    const coolingTrace = traces.find((t) => t.legendgroup === "bg_0" && t.name === "Cooling");
    expect(coolingTrace.marker.color).toContain("rgba(255,0,0,");
  });

  test("unspecified categories use palette color", async () => {
    const { viz } = mountViz();
    await runUpdate(
      viz, sampleData(),
      cfg({ band_group_1_colors: '{"Cooling":"#ff0000"}' }),
      qr(["ts.time"], ["readings.power_kw"])
    );
    const [, traces] = mockPlotly.react.mock.calls[0];
    const heatingTrace = traces.find((t) => t.legendgroup === "bg_0" && t.name === "Heating");
    // Should not be the override red
    expect(heatingTrace.marker.color).not.toContain("rgba(255,0,0,");
  });
});

// ============================================================
// 7. Hover tooltip
// ============================================================
describe("hover tooltip (customdata + hovertemplate)", () => {
  test("measure trace has customdata array matching row count", async () => {
    const { viz } = mountViz();
    await runUpdate(viz, sampleData(), cfg(), qr(["ts.time"], ["readings.power_kw"]));
    const [, traces] = mockPlotly.react.mock.calls[0];
    const measureTrace = traces.find((t) => !t.legendgroup);
    expect(measureTrace.customdata).toHaveLength(5);
  });

  test("customdata entry contains band category value", async () => {
    const { viz } = mountViz();
    await runUpdate(viz, sampleData(), cfg(), qr(["ts.time"], ["readings.power_kw"]));
    const [, traces] = mockPlotly.react.mock.calls[0];
    const measureTrace = traces.find((t) => !t.legendgroup);
    // First two rows are Cooling
    expect(measureTrace.customdata[0][0]).toBe("Cooling");
    expect(measureTrace.customdata[1][0]).toBe("Cooling");
  });

  test("customdata entry shows — for rows with no active band", async () => {
    const { viz } = mountViz();
    await runUpdate(viz, sampleData(), cfg(), qr(["ts.time"], ["readings.power_kw"]));
    const [, traces] = mockPlotly.react.mock.calls[0];
    const measureTrace = traces.find((t) => !t.legendgroup);
    // Last row has null band fields
    expect(measureTrace.customdata[4][0]).toBe("—");
  });

  test("hovertemplate includes band group label", async () => {
    const { viz } = mountViz();
    await runUpdate(viz, sampleData(), cfg(), qr(["ts.time"], ["readings.power_kw"]));
    const [, traces] = mockPlotly.react.mock.calls[0];
    const measureTrace = traces.find((t) => !t.legendgroup);
    expect(measureTrace.hovertemplate).toContain("ODU Status");
  });

  test("hovertemplate includes customdata reference", async () => {
    const { viz } = mountViz();
    await runUpdate(viz, sampleData(), cfg(), qr(["ts.time"], ["readings.power_kw"]));
    const [, traces] = mockPlotly.react.mock.calls[0];
    const measureTrace = traces.find((t) => !t.legendgroup);
    expect(measureTrace.hovertemplate).toContain("%{customdata[0]}");
  });

  test("inactive band group excluded from customdata and hovertemplate", async () => {
    const { viz } = mountViz();
    await runUpdate(viz, sampleData(), cfg(), qr(["ts.time"], ["readings.power_kw"]));
    // Deactivate group 0
    viz._activeGroups[0] = false;
    jest.clearAllMocks();
    capturedViz._rerender.call(viz);
    const [, traces] = mockPlotly.react.mock.calls[0];
    const measureTrace = traces.find((t) => !t.legendgroup);
    // customdata inner array should be empty (no active groups)
    expect(measureTrace.customdata[0]).toHaveLength(0);
    expect(measureTrace.hovertemplate).not.toContain("ODU Status");
  });
});

// ============================================================
// 8. Theme and font
// ============================================================
describe("theme and font", () => {
  test("light theme sets transparent background", async () => {
    const { viz } = mountViz();
    await runUpdate(viz, sampleData(), cfg({ chart_theme: "light" }), qr(["ts.time"], ["readings.power_kw"]));
    const [,, layout] = mockPlotly.react.mock.calls[0];
    expect(layout.paper_bgcolor).toContain("rgba(0,0,0,0)");
  });

  test("dark theme sets non-transparent background", async () => {
    const { viz } = mountViz();
    await runUpdate(viz, sampleData(), cfg({ chart_theme: "dark" }), qr(["ts.time"], ["readings.power_kw"]));
    const [,, layout] = mockPlotly.react.mock.calls[0];
    expect(layout.paper_bgcolor).not.toContain("rgba(0,0,0,0)");
  });

  test("layout global font includes Google Sans", async () => {
    const { viz } = mountViz();
    await runUpdate(viz, sampleData(), cfg(), qr(["ts.time"], ["readings.power_kw"]));
    const [,, layout] = mockPlotly.react.mock.calls[0];
    expect(layout.font.family).toContain("Google Sans");
  });

  test("xaxis tickfont uses configured tick font size", async () => {
    const { viz } = mountViz();
    await runUpdate(viz, sampleData(), cfg({ font_size_ticks: 14 }), qr(["ts.time"], ["readings.power_kw"]));
    const [,, layout] = mockPlotly.react.mock.calls[0];
    expect(layout.xaxis.tickfont.size).toBe(14);
  });

  test("axis title uses configured title font size", async () => {
    const { viz } = mountViz();
    await runUpdate(viz, sampleData(), cfg({ font_size_axis_title: 16 }), qr(["ts.time"], ["readings.power_kw"]));
    const [,, layout] = mockPlotly.react.mock.calls[0];
    expect(layout.xaxis.title.font.size).toBe(16);
    expect(layout.yaxis.title.font.size).toBe(16);
  });

  test("x_axis_label override applied to xaxis title text", async () => {
    const { viz } = mountViz();
    await runUpdate(viz, sampleData(), cfg({ x_axis_label: "Custom X Label" }), qr(["ts.time"], ["readings.power_kw"]));
    const [,, layout] = mockPlotly.react.mock.calls[0];
    expect(layout.xaxis.title.text).toBe("Custom X Label");
  });

  test("hoverlabel uses configured hover font size", async () => {
    const { viz } = mountViz();
    await runUpdate(viz, sampleData(), cfg({ font_size_hover: 15 }), qr(["ts.time"], ["readings.power_kw"]));
    const [,, layout] = mockPlotly.react.mock.calls[0];
    expect(layout.hoverlabel.font.size).toBe(15);
  });
});

// ============================================================
// 9. Legend position
// ============================================================
describe("legend position", () => {
  test("right position sets vertical orientation", async () => {
    const { viz } = mountViz();
    await runUpdate(viz, sampleData(), cfg({ legend_position: "right" }), qr(["ts.time"], ["readings.power_kw"]));
    const [,, layout] = mockPlotly.react.mock.calls[0];
    expect(layout.legend.orientation).toBe("v");
  });

  test("bottom position sets horizontal orientation", async () => {
    const { viz } = mountViz();
    await runUpdate(viz, sampleData(), cfg({ legend_position: "bottom" }), qr(["ts.time"], ["readings.power_kw"]));
    const [,, layout] = mockPlotly.react.mock.calls[0];
    expect(layout.legend.orientation).toBe("h");
  });

  test("inside position sets vertical with bgcolor", async () => {
    const { viz } = mountViz();
    await runUpdate(viz, sampleData(), cfg({ legend_position: "inside" }), qr(["ts.time"], ["readings.power_kw"]));
    const [,, layout] = mockPlotly.react.mock.calls[0];
    expect(layout.legend.orientation).toBe("v");
    expect(layout.legend.bgcolor).toBeDefined();
  });
});

// ============================================================
// 10. Active state management
// ============================================================
describe("active state management", () => {
  test("_activeGroups initialised to all true on first render", async () => {
    const { viz } = mountViz();
    await runUpdate(viz, sampleData(), cfg(), qr(["ts.time"], ["readings.power_kw"]));
    expect(viz._activeGroups[0]).toBe(true);
  });

  test("_activeCats initialised to all true for each category", async () => {
    const { viz } = mountViz();
    await runUpdate(viz, sampleData(), cfg(), qr(["ts.time"], ["readings.power_kw"]));
    expect(viz._activeCats[0]["Cooling"]).toBe(true);
    expect(viz._activeCats[0]["Heating"]).toBe(true);
  });

  test("_activeGroups preserved across config-only re-render", async () => {
    const { viz } = mountViz();
    await runUpdate(viz, sampleData(), cfg(), qr(["ts.time"], ["readings.power_kw"]));
    viz._activeGroups[0] = false;
    jest.clearAllMocks();
    // Re-render with same group config — state should persist
    await runUpdate(viz, sampleData(), cfg(), qr(["ts.time"], ["readings.power_kw"]));
    expect(viz._activeGroups[0]).toBe(false);
  });

  test("_activeGroups resets when group configuration changes", async () => {
    const { viz } = mountViz();
    await runUpdate(viz, sampleData(), cfg(), qr(["ts.time"], ["readings.power_kw"]));
    viz._activeGroups[0] = false;
    // Render with different group label → new groupSetKey → state reset
    jest.clearAllMocks();
    await runUpdate(
      viz, sampleData(),
      cfg({ band_group_1_label: "New Group Name" }),
      qr(["ts.time"], ["readings.power_kw"])
    );
    expect(viz._activeGroups[0]).toBe(true);
  });

  test("_activeCats resets when category set changes", async () => {
    const { viz } = mountViz();
    await runUpdate(viz, sampleData(), cfg(), qr(["ts.time"], ["readings.power_kw"]));
    viz._activeCats[0]["Cooling"] = false;
    // Add a new category in data → catKey changes → state reset
    const newData = [...sampleData(), row({
      "ts.time": "2026-05-14T15:00:00", "readings.power_kw": 0.3,
      "odu.period_start": "2026-05-14T15:00:00",
      "odu.period_end":   "2026-05-14T16:00:00",
      "odu.status":       "Idle",
    })];
    jest.clearAllMocks();
    await runUpdate(viz, newData, cfg(), qr(["ts.time"], ["readings.power_kw"]));
    expect(viz._activeCats[0]["Cooling"]).toBe(true);
  });

  test("inactive group shapes excluded from layout", async () => {
    const { viz } = mountViz();
    await runUpdate(viz, sampleData(), cfg(), qr(["ts.time"], ["readings.power_kw"]));
    viz._activeGroups[0] = false;
    jest.clearAllMocks();
    capturedViz._rerender.call(viz);
    const [,, layout] = mockPlotly.react.mock.calls[0];
    expect(layout.shapes).toHaveLength(0);
  });

  test("inactive category shapes excluded from layout", async () => {
    const { viz } = mountViz();
    await runUpdate(viz, sampleData(), cfg(), qr(["ts.time"], ["readings.power_kw"]));
    viz._activeCats[0]["Cooling"] = false;
    jest.clearAllMocks();
    capturedViz._rerender.call(viz);
    const [,, layout] = mockPlotly.react.mock.calls[0];
    // Only Heating shape should remain
    expect(layout.shapes).toHaveLength(1);
    expect(layout.shapes[0].x0).toBe("2026-05-14T13:00:00");
  });
});

// ============================================================
// 11. Sticky annotations
// ============================================================
describe("sticky annotations", () => {
  test("_stickyAnnotations included in initial layout", async () => {
    const { viz } = mountViz();
    viz._stickyAnnotations = [{ x: "2026-05-14T12:00:00", y: 1.2, text: "test" }];
    await runUpdate(viz, sampleData(), cfg(), qr(["ts.time"], ["readings.power_kw"]));
    const [,, layout] = mockPlotly.react.mock.calls[0];
    expect(layout.annotations).toHaveLength(1);
    expect(layout.annotations[0].text).toBe("test");
  });

  test("_stickyAnnotations included in _rerender layout", async () => {
    const { viz } = mountViz();
    await runUpdate(viz, sampleData(), cfg(), qr(["ts.time"], ["readings.power_kw"]));
    viz._stickyAnnotations = [{ x: "2026-05-14T13:00:00", y: 0.8, text: "pinned" }];
    jest.clearAllMocks();
    capturedViz._rerender.call(viz);
    const [,, layout] = mockPlotly.react.mock.calls[0];
    expect(layout.annotations).toHaveLength(1);
    expect(layout.annotations[0].text).toBe("pinned");
  });

  test("annotations empty array on fresh render with no sticky", async () => {
    const { viz } = mountViz();
    await runUpdate(viz, sampleData(), cfg(), qr(["ts.time"], ["readings.power_kw"]));
    const [,, layout] = mockPlotly.react.mock.calls[0];
    expect(layout.annotations).toEqual([]);
  });
});

// ============================================================
// 12. _rerender
// ============================================================
describe("_rerender()", () => {
  test("calls Plotly.react", async () => {
    const { viz } = mountViz();
    await runUpdate(viz, sampleData(), cfg(), qr(["ts.time"], ["readings.power_kw"]));
    jest.clearAllMocks();
    capturedViz._rerender.call(viz);
    expect(mockPlotly.react).toHaveBeenCalledTimes(1);
  });

  test("rebuilds measure traces from cache", async () => {
    const { viz } = mountViz();
    await runUpdate(viz, sampleData(), cfg(), qr(["ts.time"], ["readings.power_kw"]));
    jest.clearAllMocks();
    capturedViz._rerender.call(viz);
    const [, traces] = mockPlotly.react.mock.calls[0];
    const measureTraces = traces.filter((t) => !t.legendgroup);
    expect(measureTraces).toHaveLength(1);
  });

  test("does nothing when renderCache is null", () => {
    const { viz } = mountViz();
    // renderCache not populated — _rerender should be a no-op
    capturedViz._rerender.call(viz);
    expect(mockPlotly.react).not.toHaveBeenCalled();
  });
});

// ============================================================
// 13. Legend click handler
// ============================================================
describe("legend click handler", () => {
  test("returns false for band category trace (suppresses default)", async () => {
    const { viz } = mountViz();
    await runUpdate(viz, sampleData(), cfg(), qr(["ts.time"], ["readings.power_kw"]));

    // Find the legendclick handler attached to chartDiv
    const onCalls = viz._chartDiv.on.mock.calls;
    const clickCall = onCalls.find(([event]) => event === "plotly_legendclick");
    expect(clickCall).toBeDefined();
    const handler = clickCall[1];

    // Simulate click on a band trace
    const mockEventData = {
      data: [
        ...Array(1).fill({ name: "readings.power_kw", legendgroup: undefined }), // measure
        { name: "Cooling", legendgroup: "bg_0" }, // band trace at index 1
      ],
      curveNumber: 1,
    };

    const result = handler(mockEventData);
    expect(result).toBe(false);
  });

  test("does not return false for measure trace (allows default)", async () => {
    const { viz } = mountViz();
    await runUpdate(viz, sampleData(), cfg(), qr(["ts.time"], ["readings.power_kw"]));

    const onCalls = viz._chartDiv.on.mock.calls;
    const clickCall = onCalls.find(([event]) => event === "plotly_legendclick");
    const handler = clickCall[1];

    // Simulate click on a measure trace (no legendgroup)
    const mockEventData = {
      data: [{ name: "readings.power_kw", legendgroup: undefined }],
      curveNumber: 0,
    };

    const result = handler(mockEventData);
    expect(result).toBeUndefined(); // no return → Plotly default proceeds
  });

  test("toggling a category calls _rerender", async () => {
    const { viz } = mountViz();
    await runUpdate(viz, sampleData(), cfg(), qr(["ts.time"], ["readings.power_kw"]));

    const onCalls = viz._chartDiv.on.mock.calls;
    const clickCall = onCalls.find(([event]) => event === "plotly_legendclick");
    const handler = clickCall[1];

    jest.clearAllMocks();
    handler({
      data: [
        { name: "readings.power_kw", legendgroup: undefined },
        { name: "Cooling", legendgroup: "bg_0" },
      ],
      curveNumber: 1,
    });

    expect(viz._activeCats[0]["Cooling"]).toBe(false);
    expect(mockPlotly.react).toHaveBeenCalled();
  });
});
