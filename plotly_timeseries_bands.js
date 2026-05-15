(function () {
  // ---------------------------------------------------------------------------
  // Plotly Time Series + Plot Bands  v4
  // Looker Custom Visualization
  //
  // Hover tooltip shows:
  //   - Datetime (X axis header, from Plotly unified hover)
  //   - Continuous measure value for each trace
  //   - Active band group category value at that timestamp
  //     (updates immediately when band groups are toggled via dropdown)
  //
  // Features:
  //   - Multiple continuous measures on a shared time-series X axis
  //   - Lines, scatter (WebGL), or lines+points per trace
  //   - Up to 5 band groups (label/start/end/category field triplets)
  //   - In-chart dropdown to toggle which band groups are visible
  //   - Multiple groups active simultaneously with overlaid bands
  //   - Per-category toggles within each active group via legend click
  //   - Each group uses a distinct color palette
  //   - Toggle state persists across config changes; resets on new data
  //   - Dual Y axis support
  //
  // IMPORTANT — Plotly dependency (Admin → Visualizations → Dependencies):
  //   https://cdn.plot.ly/plotly-3.5.1.min.js
  // ---------------------------------------------------------------------------

  var MAX_GROUPS = 5;

  var GROUP_PALETTES = [
    ["rgba(99,102,241,",  "rgba(129,140,248,",  "rgba(14,165,233,",  "rgba(168,85,247,",  "rgba(56,189,248,"],
    ["rgba(249,115,22,",  "rgba(234,179,8,",    "rgba(239,68,68,",   "rgba(253,186,116,",  "rgba(252,211,77,"],
    ["rgba(20,184,166,",  "rgba(34,197,94,",    "rgba(16,185,129,",  "rgba(132,204,22,",   "rgba(74,222,128,"],
    ["rgba(244,63,94,",   "rgba(236,72,153,",   "rgba(217,70,239,",  "rgba(251,113,133,",  "rgba(232,121,249,"],
    ["rgba(100,116,139,", "rgba(148,163,184,",  "rgba(71,85,105,",   "rgba(203,213,225,",  "rgba(51,65,85,"],
  ];

  // Looker's standard 13-color series palette
  var LINE_PALETTE = [
    "#3EB0D5", "#B1399E", "#C2DD67", "#592EC2",
    "#F98131", "#67DB5E", "#78A2E5", "#FF8DA1",
    "#FFD95F", "#0096A9", "#7B7B7B", "#5CA56B", "#C3A4E1",
  ];

  // Theme presets — Light matches Looker's default dashboard style
  var THEMES = {
    light: {
      paper_bgcolor: "rgba(0,0,0,0)", plot_bgcolor: "rgba(0,0,0,0)",
      gridcolor: "#e5e7eb", linecolor: "#d1d5db", zerolinecolor: "#d1d5db",
      fontcolor: "#3d404a", arrowcolor: "#3EB0D5",
      annotationBg: "#1f2937", annotationFont: "#f9fafb", annotationBorder: "#3EB0D5",
    },
    dark: {
      paper_bgcolor: "#1f2937", plot_bgcolor: "#111827",
      gridcolor: "#374151", linecolor: "#4b5563", zerolinecolor: "#4b5563",
      fontcolor: "#f3f4f6", arrowcolor: "#3EB0D5",
      annotationBg: "#374151", annotationFont: "#f9fafb", annotationBorder: "#3EB0D5",
    },
  };

  var LOOKER_FONT = "Google Sans, Roboto, -apple-system, BlinkMacSystemFont, sans-serif";

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  function loadPlotly(cb) {
    if (window.Plotly) { cb(); return; }
    console.warn("[plotly_timeseries_bands] Add Plotly CDN to Dependencies field.");
    var s = document.createElement("script");
    s.src = "https://cdn.plot.ly/plotly-3.5.1.min.js";
    s.onload = cb;
    document.head.appendChild(s);
  }

  function fieldLabel(f) { return f.label_short || f.label || f.name; }

  function safeVal(row, name) {
    return row[name] && row[name].value !== undefined ? row[name].value : null;
  }

  function parseList(str) {
    if (!str || !str.trim()) return [];
    return str.split(",").map(function (s) { return s.trim(); }).filter(Boolean);
  }

  // Convert a 6-digit hex color to an rgba base string (opacity appended later)
  function hexToRgbaBase(hex) {
    var clean = (hex || "").replace("#", "");
    if (clean.length === 3) clean = clean[0]+clean[0]+clean[1]+clean[1]+clean[2]+clean[2];
    var r = parseInt(clean.slice(0,2),16), g = parseInt(clean.slice(2,4),16), b = parseInt(clean.slice(4,6),16);
    if (isNaN(r)||isNaN(g)||isNaN(b)) return null;
    return "rgba("+r+","+g+","+b+",";
  }

  // Parse a JSON color override string: {"Category": "#hexcolor", ...}
  // Returns {} silently on any failure — bad JSON won't break the viz
  function parseColorOverrides(jsonStr) {
    if (!jsonStr || !jsonStr.trim()) return {};
    try {
      var parsed = JSON.parse(jsonStr);
      if (typeof parsed !== "object" || Array.isArray(parsed)) return {};
      var result = {};
      Object.keys(parsed).forEach(function (cat) {
        var rgba = hexToRgbaBase(String(parsed[cat]));
        if (rgba) result[cat] = rgba;
      });
      return result;
    } catch (e) { return {}; }
  }

  function buildColorMap(categories, palette, overrides) {
    overrides = overrides || {};
    var map = {}, idx = 0;
    categories.forEach(function (c) {
      if (!map.hasOwnProperty(c))
        map[c] = overrides.hasOwnProperty(c) ? overrides[c] : palette[idx++ % palette.length];
    });
    return map;
  }

  function extractBands(data, startF, endF, catF) {
    var seen = {}, bands = [];
    data.forEach(function (row) {
      var s = safeVal(row, startF), e = safeVal(row, endF), c = safeVal(row, catF);
      if (s === null || e === null || c === null) return;
      var key = s + "\x00" + e + "\x00" + c;
      if (!seen[key]) { seen[key] = true; bands.push({ start: s, end: e, category: String(c) }); }
    });
    return bands;
  }

  function makeShape(band, rgba, opacity, border) {
    return {
      type: "rect", xref: "x", yref: "paper",
      x0: band.start, x1: band.end, y0: 0, y1: 1,
      fillcolor: rgba + opacity + ")",
      line: { width: border ? 1 : 0, color: border ? rgba + "0.6)" : "transparent" },
      layer: "below",
    };
  }

  function activeShapes(allShapes, activeCats) {
    return allShapes
      .filter(function (bs) { return activeCats[bs.category] !== false; })
      .map(function (bs) { return bs.shape; });
  }

  function groupSetKey(groups) {
    return groups.map(function (g) {
      return [g.label, g.startField, g.endField, g.catField].join("\x00");
    }).join("\x01");
  }

  // ---------------------------------------------------------------------------
  // Hover: build customdata and hovertemplate for a measure trace
  //
  // customdata[rowIdx] = [cat_group0, cat_group1, ...] for active groups only
  // hovertemplate references %{customdata[i]} for each active group
  // ---------------------------------------------------------------------------

  function buildHoverInfo(label, groups, activeGroups, bandGroupValues, rowCount) {
    // Only include groups that are currently active
    var activeGrps = groups.filter(function (g) { return activeGroups[g.idx] !== false; });

    // customdata: one entry per row, array of category values per active group
    var customdata = [];
    for (var r = 0; r < rowCount; r++) {
      customdata.push(
        activeGrps.map(function (g) {
          var val = (bandGroupValues[g.idx] || [])[r];
          return val !== null && val !== undefined ? String(val) : "—";
        })
      );
    }

    // hovertemplate: measure value + one line per active group
    // Plain text only — inline styles can be stripped by Looker's iframe sandbox
    var bandLines = activeGrps.map(function (g, i) {
      return g.label + ": %{customdata[" + i + "]}";
    }).join("<br>");

    var template = "<b>" + label + "</b>: %{y}" +
      (bandLines ? "<br>" + bandLines : "") +
      "<extra></extra>";

    return { customdata: customdata, hovertemplate: template };
  }

  // ---------------------------------------------------------------------------
  // Dropdown UI
  // ---------------------------------------------------------------------------

  function buildDropdown(controlBar, groups, activeGroups, onToggle) {
    controlBar.innerHTML = "";
    if (!groups.length) return;

    var wrapper = document.createElement("div");
    wrapper.style.cssText = "position:relative;display:inline-block;";

    var activeCount = groups.filter(function (g) { return activeGroups[g.idx] !== false; }).length;

    var trigger = document.createElement("button");
    trigger.textContent = "Band Groups (" + activeCount + " active) \u25be";
    trigger.style.cssText =
      "font-size:11px;font-family:sans-serif;padding:4px 10px;border:1px solid #d1d5db;" +
      "border-radius:5px;background:#fff;cursor:pointer;color:#374151;white-space:nowrap;line-height:1.4;";

    var panel = document.createElement("div");
    panel.style.cssText =
      "display:none;position:absolute;top:calc(100% + 4px);left:0;z-index:9999;" +
      "background:#fff;border:1px solid #e5e7eb;border-radius:6px;" +
      "box-shadow:0 4px 16px rgba(0,0,0,0.12);min-width:200px;padding:6px 0;";

    groups.forEach(function (g) {
      var isActive = activeGroups[g.idx] !== false;
      var swatch   = GROUP_PALETTES[g.idx % GROUP_PALETTES.length][0] + "0.75)";

      var row = document.createElement("label");
      row.style.cssText =
        "display:flex;align-items:center;gap:8px;padding:6px 14px;cursor:pointer;" +
        "font-size:12px;font-family:sans-serif;color:#374151;user-select:none;";
      row.onmouseover = function () { row.style.background = "#f9fafb"; };
      row.onmouseout  = function () { row.style.background = ""; };

      var cb = document.createElement("input");
      cb.type = "checkbox"; cb.checked = isActive;
      cb.style.cssText = "width:14px;height:14px;cursor:pointer;accent-color:#6366f1;";
      cb.addEventListener("change", function (e) {
        e.stopPropagation();
        onToggle(g.idx, cb.checked);
        var nowActive = groups.filter(function (gg) {
          return gg.idx === g.idx ? cb.checked : activeGroups[gg.idx] !== false;
        }).length;
        trigger.textContent = "Band Groups (" + nowActive + " active) \u25be";
      });

      var sw = document.createElement("span");
      sw.style.cssText = "display:inline-block;width:12px;height:12px;border-radius:2px;flex-shrink:0;background:" + swatch + ";";

      var lbl = document.createElement("span");
      lbl.textContent = g.label;

      row.appendChild(cb); row.appendChild(sw); row.appendChild(lbl);
      panel.appendChild(row);
    });

    var panelOpen = false;
    trigger.addEventListener("click", function (e) {
      e.stopPropagation();
      panelOpen = !panelOpen;
      panel.style.display = panelOpen ? "block" : "none";
    });
    document.addEventListener("click", function () {
      if (panelOpen) { panelOpen = false; panel.style.display = "none"; }
    });

    wrapper.appendChild(trigger); wrapper.appendChild(panel);
    controlBar.appendChild(wrapper);
  }

  // ---------------------------------------------------------------------------
  // Viz registration
  // ---------------------------------------------------------------------------

  looker.plugins.visualizations.add({
    id: "plotly_timeseries_bands",
    label: "Timeseries with Plotbands",

    options: (function () {
      var opts = {
        x_field: {
          type: "string", label: "X Field (internal: view.field_name)", display: "text", default: "",
          placeholder: "e.g. edragon_metrics.timestamp_time", section: "Chart Options", order: 1,
        },
        x_axis_label: {
          type: "string", label: "X Axis Display Label (optional override)", display: "text", default: "",
          placeholder: "e.g. Timestamp", section: "Chart Options", order: 2,
        },
        measure_fields: {
          type: "string", label: "Measure Fields (internal names, comma-separated; blank = all)",
          display: "text", default: "", section: "Chart Options", order: 3,
        },
        trace_type: {
          type: "string", label: "Trace Type", display: "select",
          values: [{ Lines: "lines" }, { "Scatter (WebGL)": "markers" }, { "Lines + Points": "lines+markers" }],
          default: "lines", section: "Chart Options", order: 3,
        },
        line_width: {
          type: "number", label: "Line Width", display: "range",
          min: 1, max: 8, step: 0.5, default: 2, section: "Chart Options", order: 4,
        },
        point_size: {
          type: "number", label: "Point Size", display: "range",
          min: 2, max: 14, step: 1, default: 4, section: "Chart Options", order: 5,
        },
        line_opacity: {
          type: "number", label: "Trace Opacity", display: "range",
          min: 0.2, max: 1.0, step: 0.05, default: 1.0, section: "Chart Options", order: 6,
        },
        connect_gaps: {
          type: "boolean", label: "Connect Nulls (draw line through missing values)",
          default: false, section: "Chart Options", order: 7,
        },
        band_opacity: {
          type: "number", label: "Band Fill Opacity", display: "range",
          min: 0.05, max: 0.9, step: 0.05, default: 0.55, section: "Chart Options", order: 7,
        },
        band_border: {
          type: "boolean", label: "Show Band Border Lines",
          default: false, section: "Chart Options", order: 8,
        },
        use_dual_axis: {
          type: "boolean", label: "Dual Y Axis (first measure left, rest right)",
          default: false, section: "Chart Options", order: 9,
        },
        y_axis_label: {
          type: "string", label: "Left Y Axis Label", display: "text", default: "",
          section: "Chart Options", order: 10,
        },
        y2_axis_label: {
          type: "string", label: "Right Y Axis Label (dual axis)", display: "text", default: "",
          section: "Chart Options", order: 11,
        },
        show_legend: {
          type: "boolean", label: "Show Legend", default: true,
          section: "Chart Options", order: 12,
        },
        chart_theme: {
          type: "string", label: "Chart Theme", display: "select",
          values: [{ "Light (Looker default)": "light" }, { "Dark": "dark" }],
          default: "light", section: "Chart Options", order: 13,
        },
        legend_position: {
          type: "string", label: "Legend Position", display: "select",
          values: [
            { "Bottom (horizontal)": "bottom" },
            { "Right (vertical)":    "right"  },
            { "Inside top-right":    "inside" },
          ],
          default: "right", section: "Chart Options", order: 13,
        },
        font_size_axis_title: {
          type: "number", label: "Axis Title Font Size", display: "range",
          min: 8, max: 24, step: 1, default: 12, section: "Chart Options", order: 14,
        },
        font_size_ticks: {
          type: "number", label: "Tick Label Font Size", display: "range",
          min: 8, max: 20, step: 1, default: 11, section: "Chart Options", order: 15,
        },
        font_size_legend: {
          type: "number", label: "Legend Font Size", display: "range",
          min: 8, max: 20, step: 1, default: 11, section: "Chart Options", order: 16,
        },
        font_size_hover: {
          type: "number", label: "Hover Label Font Size", display: "range",
          min: 8, max: 20, step: 1, default: 12, section: "Chart Options", order: 17,
        },
      };

      var defaultLabels = ["Battery Schedule", "ODU Status", "Group 3", "Group 4", "Group 5"];
      for (var i = 1; i <= MAX_GROUPS; i++) {
        var b = "band_group_" + i + "_", sec = "Band Group " + i, ord = 20 + (i - 1) * 4;
        opts[b + "label"] = { type: "string", label: "Label", display: "text",
          default: defaultLabels[i - 1] || "", section: sec, order: ord };
        opts[b + "start"] = { type: "string", label: "Start Timestamp Field", display: "text",
          default: "", placeholder: "view.field_start", section: sec, order: ord + 1 };
        opts[b + "end"]   = { type: "string", label: "End Timestamp Field", display: "text",
          default: "", placeholder: "view.field_end", section: sec, order: ord + 2 };
        opts[b + "cat"]   = { type: "string", label: "Category Field", display: "text",
          default: "", placeholder: "view.field_category", section: sec, order: ord + 3 };
        opts[b + "colors"] = {
          type: "string", label: "Color Overrides (JSON)",
          display: "text", default: "",
          placeholder: '{"Cooling":"#14b8a6","Heating":"#ef4444"}',
          section: sec, order: ord + 4,
        };
      }
      return opts;
    }()),

    // -------------------------------------------------------------------------
    create: function (element) {
      this._wrapper = document.createElement("div");
      this._wrapper.style.cssText =
        "position:relative;width:100%;height:100%;display:flex;flex-direction:column;overflow:hidden;";

      this._controlBar = document.createElement("div");
      this._controlBar.style.cssText =
        "flex-shrink:0;padding:4px 8px 4px 0;display:flex;align-items:center;gap:8px;min-height:28px;";

      this._chartDiv = document.createElement("div");
      this._chartDiv.style.cssText = "flex:1;min-height:0;";

      this._wrapper.appendChild(this._controlBar);
      this._wrapper.appendChild(this._chartDiv);
      element.appendChild(this._wrapper);
      element.style.overflow = "hidden";

      // Persistent state
      this._activeGroups      = {};
      this._activeCats        = {};
      this._allBandShapes     = {};
      this._bandColorMaps     = {};
      this._bandCatTraceIdx   = {};
      this._groupSetKey       = null;
      this._stickyAnnotations = [];   // pinned click annotations

      // Cached inputs for rerender (hover rebuild needs these)
      this._renderCache     = null;
    },

    // -------------------------------------------------------------------------
    updateAsync: function (data, element, config, queryResponse, details, done) {
      var self = this;

      loadPlotly(function () {
        try {
          var dims = queryResponse.fields.dimensions || [];
          var meas = queryResponse.fields.measures   || [];
          var allF = dims.concat(meas);

          if (!allF.length) { self._err(element, "Add at least one field."); done(); return; }

          var xField    = (config.x_field || "").trim() || (dims.length ? dims[0].name : allF[0].name);
          var measNames = parseList(config.measure_fields);
          if (!measNames.length) measNames = meas.map(function (f) { return f.name; });

          // ---- Parse band group configs ----
          var groups = [];
          for (var i = 1; i <= MAX_GROUPS; i++) {
            var b     = "band_group_" + i + "_";
            var label = (config[b + "label"] || "").trim();
            var start = (config[b + "start"] || "").trim();
            var end   = (config[b + "end"]   || "").trim();
            var cat   = (config[b + "cat"]   || "").trim();
            var colorJson = (config[b + "colors"] || "").trim();
            if (label && start && end && cat) groups.push({ idx: i - 1, label: label, startField: start, endField: end, catField: cat, colorOverrides: parseColorOverrides(colorJson) });
          }

          // Reset active-group state only when configured groups change
          var newGroupKey = groupSetKey(groups);
          if (self._groupSetKey !== newGroupKey) {
            self._activeGroups = {};
            groups.forEach(function (g) { self._activeGroups[g.idx] = true; });
            self._groupSetKey = newGroupKey;
          }

          var traceType   = config.trace_type  || "lines";
          var useWebGL    = traceType === "markers";
          var dualAxis    = !!(config.use_dual_axis && measNames.length > 1);
          var lineWidth   = config.line_width   != null ? config.line_width   : 2;
          var pointSize   = config.point_size   != null ? config.point_size   : 4;
          var lineOp      = config.line_opacity != null ? config.line_opacity : 1.0;
          var connectGaps = !!config.connect_gaps;
          var bandOp      = config.band_opacity != null ? config.band_opacity : 0.18;
          var showBorder  = !!config.band_border;

          // ---- Build time-series + band category arrays in a single pass ----
          var xArr            = [];
          var yArrs           = {};
          var bandGroupValues = {};   // groupIdx → [categoryValue or null, ...]

          measNames.forEach(function (n) { yArrs[n] = []; });
          groups.forEach(function (g) { bandGroupValues[g.idx] = []; });

          data.forEach(function (row) {
            var xv = safeVal(row, xField);
            if (xv === null) return;
            xArr.push(xv);
            measNames.forEach(function (n) { yArrs[n].push(safeVal(row, n)); });
            groups.forEach(function (g) {
              var cv = safeVal(row, g.catField);
              bandGroupValues[g.idx].push(cv !== null ? String(cv) : null);
            });
          });

          if (!xArr.length) {
            self._err(element, "No plottable data — confirm the X field contains values.");
            done(); return;
          }

          // ---- Build measure traces with rich hover ----
          var traces = [];

          measNames.forEach(function (name, idx) {
            var meta  = allF.find(function (f) { return f.name === name; });
            var label = meta ? fieldLabel(meta) : name;
            var color = LINE_PALETTE[idx % LINE_PALETTE.length];
            var hover = buildHoverInfo(label, groups, self._activeGroups, bandGroupValues, xArr.length);

            var t = {
              type: useWebGL ? "scattergl" : "scatter",
              mode: traceType, name: label,
              x: xArr, y: yArrs[name],
              opacity: lineOp,
              connectgaps: connectGaps,
              yaxis: (dualAxis && idx > 0) ? "y2" : "y",
              customdata: hover.customdata,
              hovertemplate: hover.hovertemplate,
            };
            if (traceType !== "markers") t.line   = { color: color, width: lineWidth };
            if (traceType !== "lines")   t.marker = { color: color, size: pointSize };
            traces.push(t);
          });

          var measTraceCount = traces.length;

          // ---- Process band groups ----
          self._allBandShapes   = {};
          self._bandColorMaps   = {};
          self._bandCatTraceIdx = {};
          var allShapes = [];

          groups.forEach(function (g) {
            var palette  = GROUP_PALETTES[g.idx % GROUP_PALETTES.length];
            var bands    = extractBands(data, g.startField, g.endField, g.catField);
            var cats     = bands.map(function (b) { return b.category; });
            var colorMap = buildColorMap(cats, palette, g.colorOverrides);

            self._bandColorMaps[g.idx] = colorMap;

            var catKey = cats.slice().sort().join("\x00");
            if (!self._activeCats[g.idx] || self._activeCats[g.idx].__key !== catKey) {
              var state = { __key: catKey };
              cats.forEach(function (c) { state[c] = true; });
              self._activeCats[g.idx] = state;
            }

            self._allBandShapes[g.idx] = bands.map(function (band) {
              return { category: band.category, shape: makeShape(band, colorMap[band.category], bandOp, showBorder) };
            });

            if (self._activeGroups[g.idx] !== false) {
              allShapes = allShapes.concat(activeShapes(self._allBandShapes[g.idx], self._activeCats[g.idx]));
              Object.keys(colorMap).forEach(function (cat) {
                if (cat === "__key") return;
                var isOn = self._activeCats[g.idx][cat] !== false;
                var rgba = colorMap[cat];
                self._bandCatTraceIdx[g.idx + ":" + cat] = traces.length;
                traces.push({
                  type: "scatter", mode: "markers", name: cat,
                  legendgroup: "bg_" + g.idx,
                  legendgrouptitle: { text: g.label, font: { size: 11, color: "#6b7280" } },
                  x: [null], y: [null],
                  marker: { color: rgba + (isOn ? "0.75)" : "0.2)"), size: 12, symbol: isOn ? "square" : "square-open" },
                  showlegend: true, hoverinfo: "skip",
                });
              });
            }
          });

          // ---- Layout ----
          var xMeta = allF.find(function (f) { return f.name === xField; });
          var autoYLabel = "";
          if (measNames.length === 1) {
            var ym = allF.find(function (f) { return f.name === measNames[0]; });
            if (ym) autoYLabel = fieldLabel(ym);
          }

          var legendPos   = config.legend_position || "right";
          var showLegend  = config.show_legend !== false;
          var theme       = THEMES[config.chart_theme] || THEMES.light;
          var fsAxisTitle = config.font_size_axis_title != null ? config.font_size_axis_title : 12;
          var fsTicks     = config.font_size_ticks      != null ? config.font_size_ticks      : 11;
          var fsLegend    = config.font_size_legend     != null ? config.font_size_legend     : 11;
          var fsHover     = config.font_size_hover      != null ? config.font_size_hover      : 12;

          // Legend config and margin vary by position
          var legendCfg, marginB, marginR;
          if (legendPos === "bottom") {
            legendCfg = { orientation: "h", x: 0, y: -0.15,
                          xanchor: "left", yanchor: "top",
                          font: { size: fsLegend }, traceorder: "grouped" };
            marginB = showLegend ? 80 : 32;
            marginR = dualAxis ? 80 : 32;
          } else if (legendPos === "inside") {
            legendCfg = { orientation: "v", x: 1, y: 1,
                          xanchor: "right", yanchor: "top",
                          bgcolor: "rgba(255,255,255,0.85)",
                          bordercolor: "#e5e7eb", borderwidth: 1,
                          font: { size: fsLegend }, traceorder: "grouped" };
            marginB = 32;
            marginR = dualAxis ? 80 : 32;
          } else {
            // right (default) — vertical legend on right side
            legendCfg = { orientation: "v", x: 1.02, y: 1,
                          xanchor: "left", yanchor: "top",
                          font: { size: fsLegend }, traceorder: "grouped" };
            marginB = 32;
            marginR = showLegend ? 160 : (dualAxis ? 80 : 32);
          }

          var layout = {
            margin: { t: 16, r: marginR, b: marginB, l: 64 },
            paper_bgcolor: theme.paper_bgcolor,
            plot_bgcolor:  theme.plot_bgcolor,
            font: { family: LOOKER_FONT, color: theme.fontcolor },
            shapes: allShapes,
            annotations: self._stickyAnnotations || [],
            showlegend: showLegend,
            legend: legendCfg,
            xaxis: {
              title: { text: (config.x_axis_label || "").trim() || (xMeta ? fieldLabel(xMeta) : xField), font: { size: fsAxisTitle, family: LOOKER_FONT } },
              tickfont: { size: fsTicks, family: LOOKER_FONT, color: theme.fontcolor },
              type: "date", gridcolor: theme.gridcolor, linecolor: theme.linecolor, automargin: true,
            },
            yaxis: {
              title: { text: (config.y_axis_label || "").trim() || autoYLabel, font: { size: fsAxisTitle, family: LOOKER_FONT } },
              tickfont: { size: fsTicks, family: LOOKER_FONT, color: theme.fontcolor },
              gridcolor: theme.gridcolor, linecolor: theme.linecolor, zerolinecolor: theme.zerolinecolor, automargin: true,
            },
            hoverlabel: { bgcolor: theme.annotationBg, font: { color: theme.annotationFont, size: fsHover, family: LOOKER_FONT }, bordercolor: theme.linecolor },
            hovermode: "x unified",
          };

          if (dualAxis) {
            layout.yaxis2 = {
              title: { text: (config.y2_axis_label || "").trim(), font: { size: fsAxisTitle, family: LOOKER_FONT } },
              tickfont: { size: fsTicks, family: LOOKER_FONT, color: theme.fontcolor },
              overlaying: "y", side: "right", gridcolor: "transparent",
              linecolor: theme.linecolor, automargin: true,
            };
          }

          // Cache everything needed for rerender
          self._renderCache = {
            measTraceCount: measTraceCount,
            measTraceParams: measNames.map(function (name, idx) {
              var meta  = allF.find(function (f) { return f.name === name; });
              var label = meta ? fieldLabel(meta) : name;
              var color = LINE_PALETTE[idx % LINE_PALETTE.length];
              return { name: name, label: label, color: color,
                       yArr: yArrs[name], onY2: dualAxis && idx > 0 };
            }),
            xArr: xArr,
            groups: groups,
            bandGroupValues: bandGroupValues,
            layout: layout,
            traceType: traceType, useWebGL: useWebGL,
            lineWidth: lineWidth, pointSize: pointSize, lineOp: lineOp, connectGaps: connectGaps,
            legendPos: legendPos, showLegend: showLegend,
            fsAxisTitle: fsAxisTitle, fsTicks: fsTicks, fsLegend: fsLegend, fsHover: fsHover,
            theme: theme,
          };

          Plotly.react(self._chartDiv, traces, layout, {
            responsive: true, displayModeBar: true,
            modeBarButtonsToRemove: ["sendDataToCloud", "lasso2d", "select2d"],
            displaylogo: false, toImageButtonOptions: { format: "png", scale: 2 },
          });

          buildDropdown(self._controlBar, groups, self._activeGroups, function (groupIdx, isNowOn) {
            self._activeGroups[groupIdx] = isNowOn;
            self._rerender();
          });

          self._attachLegendHandlers(groups);
          self._attachClickHandlers();

        } catch (err) {
          self._err(element, "Visualization error: " + err.message);
          console.error("[plotly_timeseries_bands]", err);
        }
        done();
      });
    },

    // -------------------------------------------------------------------------
    // _rerender — rebuild from cache when dropdown or legend toggle changes state
    // -------------------------------------------------------------------------
    _rerender: function () {
      var self  = this;
      var cache = self._renderCache;
      if (!cache) return;

      var groups          = cache.groups;
      var bandGroupValues = cache.bandGroupValues;
      var xArr            = cache.xArr;

      // Rebuild measure traces with updated hover (active groups may have changed)
      var traces = [];
      cache.measTraceParams.forEach(function (p, idx) {
        var hover = buildHoverInfo(p.label, groups, self._activeGroups, bandGroupValues, xArr.length);
        var t = {
          type: cache.useWebGL ? "scattergl" : "scatter",
          mode: cache.traceType, name: p.label,
          x: xArr, y: p.yArr,
          opacity: cache.lineOp,
          connectgaps: cache.connectGaps,
          yaxis: p.onY2 ? "y2" : "y",
          customdata: hover.customdata,
          hovertemplate: hover.hovertemplate,
        };
        if (cache.traceType !== "markers") t.line   = { color: p.color, width: cache.lineWidth };
        if (cache.traceType !== "lines")   t.marker = { color: p.color, size: cache.pointSize };
        traces.push(t);
      });

      // Rebuild band dummy traces and shapes
      self._bandCatTraceIdx = {};
      var allShapes = [];

      groups.forEach(function (g) {
        var colorMap = self._bandColorMaps[g.idx];
        if (!colorMap) return;

        if (self._activeGroups[g.idx] !== false) {
          allShapes = allShapes.concat(
            activeShapes(self._allBandShapes[g.idx] || [], self._activeCats[g.idx] || {})
          );
          Object.keys(colorMap).forEach(function (cat) {
            if (cat === "__key") return;
            var isOn = (self._activeCats[g.idx] || {})[cat] !== false;
            var rgba = colorMap[cat];
            self._bandCatTraceIdx[g.idx + ":" + cat] = traces.length;
            traces.push({
              type: "scatter", mode: "markers", name: cat,
              legendgroup: "bg_" + g.idx,
              legendgrouptitle: { text: g.label, font: { size: 11, color: "#6b7280" } },
              x: [null], y: [null],
              marker: { color: rgba + (isOn ? "0.75)" : "0.2)"), size: 12, symbol: isOn ? "square" : "square-open" },
              showlegend: true, hoverinfo: "skip",
            });
          });
        }
      });

      Plotly.react(self._chartDiv, traces,
        Object.assign({}, cache.layout, { shapes: allShapes, annotations: self._stickyAnnotations || [] }), {
          responsive: true, displayModeBar: true,
          modeBarButtonsToRemove: ["sendDataToCloud", "lasso2d", "select2d"],
          displaylogo: false,
        }
      );

      self._attachLegendHandlers(groups);
      self._attachClickHandlers();
    },

    // -------------------------------------------------------------------------
    _attachLegendHandlers: function (groups) {
      var self = this;

      // Guard: removeAllListeners may not exist before first Plotly render
      if (typeof self._chartDiv.removeAllListeners === "function") {
        self._chartDiv.removeAllListeners("plotly_legendclick");
        self._chartDiv.removeAllListeners("plotly_legenddoubleclick");
      }

      // No band groups configured — nothing to intercept, let Plotly handle all clicks
      if (!groups || !groups.length) return;

      self._chartDiv.on("plotly_legendclick", function (eventData) {
        // Plotly 3.x: use data[curveNumber]; v2 fallback: eventData.trace
        var trace = (eventData.data && eventData.curveNumber != null)
          ? eventData.data[eventData.curveNumber]
          : eventData.trace;
        if (!trace) return; // unknown structure — allow default

        var lg   = trace.legendgroup || "";
        var name = trace.name;

        // Not a band category — allow Plotly's default toggle
        if (!lg.startsWith("bg_")) return;

        var groupIdx = parseInt(lg.replace("bg_", ""), 10);
        var catState = self._activeCats[groupIdx];
        if (!catState || !catState.hasOwnProperty(name)) return;

        catState[name] = !catState[name];
        self._rerender();
        return false; // suppress default toggle for band traces only
      });

      self._chartDiv.on("plotly_legenddoubleclick", function (eventData) {
        var trace = (eventData.data && eventData.curveNumber != null)
          ? eventData.data[eventData.curveNumber]
          : eventData.trace;
        if (!trace) return;

        var lg   = trace.legendgroup || "";
        var name = trace.name;
        if (!lg.startsWith("bg_")) return;

        var groupIdx    = parseInt(lg.replace("bg_", ""), 10);
        var catState    = self._activeCats[groupIdx];
        if (!catState) return;

        var realCats    = Object.keys(catState).filter(function (k) { return k !== "__key"; });
        var alreadySolo = realCats.every(function (c) {
          return c === name ? catState[c] !== false : catState[c] === false;
        });
        realCats.forEach(function (c) { catState[c] = alreadySolo ? true : (c === name); });
        self._rerender();
        return false;
      });
    },

    // -------------------------------------------------------------------------
    // _attachClickHandlers — sticky pinned annotations on point click
    //
    // Click a data point  → pin a tooltip annotation at that point
    // Click the annotation → dismiss it
    // Each click on a new point replaces the existing annotation (single pin)
    // -------------------------------------------------------------------------
    _attachClickHandlers: function () {
      var self = this;

      if (typeof self._chartDiv.removeAllListeners === "function") {
        self._chartDiv.removeAllListeners("plotly_click");
        self._chartDiv.removeAllListeners("plotly_clickannotation");
      }

      self._chartDiv.on("plotly_click", function (eventData) {
        if (!eventData || !eventData.points || !eventData.points.length) return;

        var pt    = eventData.points[0];
        var cache = self._renderCache;

        // Skip band dummy traces (null x/y)
        if (pt.x === null || pt.y === null || !cache) return;

        var fsHover = cache.fsHover || 12;
        var ptIdx   = pt.pointIndex;
        var groups  = cache.groups || [];

        // Format timestamp
        var xLabel = typeof pt.x === "string" ? pt.x : new Date(pt.x).toLocaleString();

        // Build annotation text lines
        var lines = [
          "<b>" + xLabel + "</b>",
          pt.data.name + ": <b>" + (pt.y !== null ? pt.y : "—") + "</b>",
        ];

        // Add active band group category values at this point's row index
        groups.forEach(function (g) {
          if (self._activeGroups[g.idx] === false) return;
          var vals = (cache.bandGroupValues || {})[g.idx] || [];
          var cat  = vals[ptIdx];
          lines.push(g.label + ": <b>" + (cat !== null && cat !== undefined ? cat : "—") + "</b>");
        });

        var th = (cache.theme) || THEMES.light;
        var annotation = {
          x: pt.x,
          y: pt.y,
          xref: "x",
          yref: (pt.data.yaxis === "y2") ? "y2" : "y",
          text: lines.join("<br>"),
          showarrow: true,
          arrowhead: 2,
          arrowsize: 0.8,
          arrowwidth: 1.5,
          arrowcolor: th.arrowcolor,
          bgcolor: th.annotationBg,
          font: { color: th.annotationFont, size: fsHover, family: LOOKER_FONT },
          bordercolor: th.annotationBorder,
          borderwidth: 1,
          borderpad: 8,
          captureevents: true,
          clicktoshow: false,
        };

        self._stickyAnnotations = [annotation];
        Plotly.relayout(self._chartDiv, { annotations: self._stickyAnnotations });
      });

      // Click the annotation itself to dismiss it
      self._chartDiv.on("plotly_clickannotation", function () {
        self._stickyAnnotations = [];
        Plotly.relayout(self._chartDiv, { annotations: [] });
      });
    },

    // -------------------------------------------------------------------------
    _err: function (element, msg) {
      var d = document.createElement("div");
      d.style.cssText = "padding:16px;color:#b91c1c;font-size:13px;font-family:sans-serif;";
      d.textContent = "\u26a0 " + msg;
      element.appendChild(d);
    },
  });
})();
