(function () {
  // ---------------------------------------------------------------------------
  // Plotly Time Series + Plot Bands  v3
  // Looker Custom Visualization
  //
  // Features:
  //   - Multiple continuous measures on a shared time-series X axis
  //   - Lines, scatter (WebGL), or lines+points per trace
  //   - Up to 5 independently configured band groups (e.g. Battery Schedule,
  //     ODU Status, ...) each with its own start/end/category field triplet
  //   - In-chart dropdown to toggle which band groups are visible
  //   - Multiple groups can be active simultaneously (overlaid)
  //   - Per-category toggles within each active group via legend click
  //   - Each group uses a distinct color palette for visual separation
  //   - Toggle state persists across config changes; resets on new data
  //   - Dual Y axis support
  //
  // IMPORTANT — Plotly dependency:
  //   Admin → Platform → Visualizations → Dependencies:
  //   https://cdn.plot.ly/plotly-2.27.0.min.js
  // ---------------------------------------------------------------------------

  var MAX_GROUPS = 5;

  // Per-group palettes — distinct hue families so groups are visually separable
  var GROUP_PALETTES = [
    ["rgba(99,102,241,",  "rgba(129,140,248,",  "rgba(14,165,233,",  "rgba(168,85,247,",  "rgba(56,189,248,"],  // indigo/blue/purple
    ["rgba(249,115,22,",  "rgba(234,179,8,",   "rgba(239,68,68,",   "rgba(253,186,116,",  "rgba(252,211,77,"],  // orange/amber/red
    ["rgba(20,184,166,",  "rgba(34,197,94,",   "rgba(16,185,129,",  "rgba(132,204,22,",   "rgba(74,222,128,"],  // teal/green/lime
    ["rgba(244,63,94,",   "rgba(236,72,153,",  "rgba(217,70,239,",  "rgba(251,113,133,",  "rgba(232,121,249,"], // rose/pink/fuchsia
    ["rgba(100,116,139,", "rgba(148,163,184,", "rgba(71,85,105,",   "rgba(203,213,225,",  "rgba(51,65,85,"],    // slate
  ];

  // Measure trace palette
  var LINE_PALETTE = [
    "#6366f1", "#f97316", "#14b8a6", "#f43f5e",
    "#eab308", "#a855f7", "#22c55e", "#0ea5e9", "#ec4899", "#84cc16",
  ];

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  function loadPlotly(cb) {
    if (window.Plotly) { cb(); return; }
    console.warn("[plotly_timeseries_bands] Add Plotly CDN to Dependencies field.");
    var s = document.createElement("script");
    s.src = "https://cdn.plot.ly/plotly-2.27.0.min.js";
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

  function buildColorMap(categories, palette) {
    var map = {}, idx = 0;
    categories.forEach(function (c) {
      if (!map.hasOwnProperty(c)) map[c] = palette[idx++ % palette.length];
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

  // Fingerprint an array of group configs for change detection
  function groupSetKey(groups) {
    return groups.map(function (g) {
      return [g.label, g.startField, g.endField, g.catField].join("\x00");
    }).join("\x01");
  }

  // ---------------------------------------------------------------------------
  // Dropdown UI builder
  // ---------------------------------------------------------------------------

  function buildDropdown(controlBar, groups, activeGroups, onToggle) {
    controlBar.innerHTML = "";
    if (!groups.length) return;

    // Wrapper
    var wrapper = document.createElement("div");
    wrapper.style.cssText = "position:relative;display:inline-block;";

    // Trigger button
    var trigger = document.createElement("button");
    var activeCount = groups.filter(function (g) { return activeGroups[g.idx] !== false; }).length;
    trigger.textContent = "Band Groups (" + activeCount + " active) ▾";
    trigger.style.cssText =
      "font-size:11px;font-family:sans-serif;padding:4px 10px;border:1px solid #d1d5db;" +
      "border-radius:5px;background:#fff;cursor:pointer;color:#374151;" +
      "white-space:nowrap;line-height:1.4;";

    // Dropdown panel
    var panel = document.createElement("div");
    panel.style.cssText =
      "display:none;position:absolute;top:calc(100% + 4px);left:0;z-index:9999;" +
      "background:#fff;border:1px solid #e5e7eb;border-radius:6px;" +
      "box-shadow:0 4px 16px rgba(0,0,0,0.12);min-width:200px;padding:6px 0;";

    groups.forEach(function (g) {
      var isActive = activeGroups[g.idx] !== false;
      var palette  = GROUP_PALETTES[g.idx % GROUP_PALETTES.length];
      var swatchColor = palette[0] + "0.75)";

      var row = document.createElement("label");
      row.style.cssText =
        "display:flex;align-items:center;gap:8px;padding:6px 14px;" +
        "cursor:pointer;font-size:12px;font-family:sans-serif;color:#374151;" +
        "user-select:none;";
      row.onmouseover = function () { row.style.background = "#f9fafb"; };
      row.onmouseout  = function () { row.style.background = ""; };

      var cb = document.createElement("input");
      cb.type    = "checkbox";
      cb.checked = isActive;
      cb.style.cssText = "width:14px;height:14px;cursor:pointer;accent-color:#6366f1;";
      cb.addEventListener("change", function (e) {
        e.stopPropagation();
        onToggle(g.idx, cb.checked);
        // Update trigger label
        var nowActive = groups.filter(function (gg) {
          return gg.idx === g.idx ? cb.checked : activeGroups[gg.idx] !== false;
        }).length;
        trigger.textContent = "Band Groups (" + nowActive + " active) ▾";
      });

      var swatch = document.createElement("span");
      swatch.style.cssText =
        "display:inline-block;width:12px;height:12px;border-radius:2px;flex-shrink:0;" +
        "background:" + swatchColor + ";";

      var lbl = document.createElement("span");
      lbl.textContent = g.label;

      row.appendChild(cb);
      row.appendChild(swatch);
      row.appendChild(lbl);
      panel.appendChild(row);
    });

    // Toggle open/close
    var panelOpen = false;
    trigger.addEventListener("click", function (e) {
      e.stopPropagation();
      panelOpen = !panelOpen;
      panel.style.display = panelOpen ? "block" : "none";
    });

    // Close on outside click
    document.addEventListener("click", function () {
      if (panelOpen) { panelOpen = false; panel.style.display = "none"; }
    });

    wrapper.appendChild(trigger);
    wrapper.appendChild(panel);
    controlBar.appendChild(wrapper);
  }

  // ---------------------------------------------------------------------------
  // Visualization registration
  // ---------------------------------------------------------------------------

  looker.plugins.visualizations.add({
    id: "plotly_timeseries_bands",
    label: "Plotly Time Series + Plot Bands",

    options: (function () {
      var opts = {
        // ---- Field mapping ----
        x_field: {
          type: "string", label: "X (Time) Field", display: "text", default: "",
          placeholder: "e.g. readings.timestamp", section: "Field Mapping", order: 1,
        },
        measure_fields: {
          type: "string", label: "Measure Fields (comma-separated; blank = all)",
          display: "text", default: "", placeholder: "e.g. readings.power_kw, readings.temp_f",
          section: "Field Mapping", order: 2,
        },
        // ---- Trace style ----
        trace_type: {
          type: "string", label: "Trace Type", display: "select",
          values: [{ Lines: "lines" }, { "Scatter (WebGL)": "markers" }, { "Lines + Points": "lines+markers" }],
          default: "lines", section: "Trace Style", order: 3,
        },
        line_width: {
          type: "number", label: "Line Width", display: "range",
          min: 1, max: 8, step: 0.5, default: 2, section: "Trace Style", order: 4,
        },
        point_size: {
          type: "number", label: "Point Size", display: "range",
          min: 2, max: 14, step: 1, default: 4, section: "Trace Style", order: 5,
        },
        line_opacity: {
          type: "number", label: "Trace Opacity", display: "range",
          min: 0.2, max: 1.0, step: 0.05, default: 1.0, section: "Trace Style", order: 6,
        },
        // ---- Band style ----
        band_opacity: {
          type: "number", label: "Band Fill Opacity", display: "range",
          min: 0.05, max: 0.5, step: 0.05, default: 0.18, section: "Band Style", order: 7,
        },
        band_border: {
          type: "boolean", label: "Show Band Border Lines",
          default: false, section: "Band Style", order: 8,
        },
        // ---- Axes & legend ----
        use_dual_axis: {
          type: "boolean", label: "Dual Y Axis (first measure left, rest right)",
          default: false, section: "Axes & Legend", order: 9,
        },
        y_axis_label: {
          type: "string", label: "Left Y Axis Label", display: "text", default: "",
          section: "Axes & Legend", order: 10,
        },
        y2_axis_label: {
          type: "string", label: "Right Y Axis Label (dual axis)", display: "text", default: "",
          section: "Axes & Legend", order: 11,
        },
        show_legend: {
          type: "boolean", label: "Show Legend", default: true,
          section: "Axes & Legend", order: 12,
        },
      };

      // Inject options for each band group (1–5)
      var groupLabels = ["Battery Schedule", "ODU Status", "Group 3", "Group 4", "Group 5"];
      for (var i = 1; i <= MAX_GROUPS; i++) {
        var base  = "band_group_" + i + "_";
        var sec   = "Band Group " + i;
        var order = 20 + (i - 1) * 4;
        opts[base + "label"] = {
          type: "string", label: "Label", display: "text",
          default: i <= groupLabels.length ? groupLabels[i - 1] : "",
          section: sec, order: order,
        };
        opts[base + "start"] = {
          type: "string", label: "Start Timestamp Field", display: "text", default: "",
          placeholder: "e.g. battery.period_start", section: sec, order: order + 1,
        };
        opts[base + "end"] = {
          type: "string", label: "End Timestamp Field", display: "text", default: "",
          placeholder: "e.g. battery.period_end", section: sec, order: order + 2,
        };
        opts[base + "cat"] = {
          type: "string", label: "Category Field", display: "text", default: "",
          placeholder: "e.g. battery.action", section: sec, order: order + 3,
        };
      }

      return opts;
    }()),

    // -----------------------------------------------------------------------
    // create — called once on first load
    // -----------------------------------------------------------------------
    create: function (element) {
      // Flex column: control bar on top, Plotly chart fills the rest
      this._wrapper = document.createElement("div");
      this._wrapper.style.cssText =
        "position:relative;width:100%;height:100%;display:flex;flex-direction:column;overflow:hidden;";

      this._controlBar = document.createElement("div");
      this._controlBar.style.cssText =
        "flex-shrink:0;padding:4px 8px 4px 0;display:flex;align-items:center;" +
        "gap:8px;min-height:28px;";

      this._chartDiv = document.createElement("div");
      this._chartDiv.style.cssText = "flex:1;min-height:0;";

      this._wrapper.appendChild(this._controlBar);
      this._wrapper.appendChild(this._chartDiv);
      element.appendChild(this._wrapper);
      element.style.overflow = "hidden";

      // Persistent state
      this._activeGroups    = {};   // groupIdx → bool
      this._activeCats      = {};   // groupIdx → { cat → bool, __key → string }
      this._allBandShapes   = {};   // groupIdx → [{ category, shape }]
      this._bandColorMaps   = {};   // groupIdx → { cat → rgbaBase }
      this._bandCatTraceIdx = {};   // "groupIdx:cat" → traceIndex
      this._groupSetKey     = null;

      // Cache for re-renders triggered by dropdown toggle
      this._renderCache     = null;
    },

    // -----------------------------------------------------------------------
    // updateAsync — called on every data or config change from Looker
    // -----------------------------------------------------------------------
    updateAsync: function (data, element, config, queryResponse, details, done) {
      var self = this;

      loadPlotly(function () {
        try {
          var dims = queryResponse.fields.dimensions || [];
          var meas = queryResponse.fields.measures   || [];
          var allF = dims.concat(meas);

          if (!allF.length) {
            self._err(element, "Add at least one field.");
            done(); return;
          }

          // ---- Resolve x / measure fields ----
          var xField = (config.x_field || "").trim() ||
            (dims.length ? dims[0].name : allF[0].name);

          var measNames = parseList(config.measure_fields);
          if (!measNames.length) measNames = meas.map(function (f) { return f.name; });

          // ---- Parse band group configs ----
          var groups = [];
          for (var i = 1; i <= MAX_GROUPS; i++) {
            var base  = "band_group_" + i + "_";
            var label = (config[base + "label"] || "").trim();
            var start = (config[base + "start"] || "").trim();
            var end   = (config[base + "end"]   || "").trim();
            var cat   = (config[base + "cat"]   || "").trim();
            if (label && start && end && cat) {
              groups.push({ idx: i - 1, label: label, startField: start, endField: end, catField: cat });
            }
          }

          // ---- Reset active-groups state only when configured groups change ----
          var newGroupKey = groupSetKey(groups);
          if (self._groupSetKey !== newGroupKey) {
            self._activeGroups = {};
            groups.forEach(function (g) { self._activeGroups[g.idx] = true; });
            self._groupSetKey = newGroupKey;
          }

          var traceType  = config.trace_type  || "lines";
          var useWebGL   = traceType === "markers";
          var dualAxis   = !!(config.use_dual_axis && measNames.length > 1);
          var lineWidth  = config.line_width   != null ? config.line_width   : 2;
          var pointSize  = config.point_size   != null ? config.point_size   : 4;
          var lineOp     = config.line_opacity != null ? config.line_opacity : 1.0;
          var bandOp     = config.band_opacity != null ? config.band_opacity : 0.18;
          var showBorder = !!config.band_border;

          // ---- Build time-series arrays ----
          var xArr = [], yArrs = {};
          measNames.forEach(function (n) { yArrs[n] = []; });
          data.forEach(function (row) {
            var xv = safeVal(row, xField);
            if (xv === null) return;
            xArr.push(xv);
            measNames.forEach(function (n) { yArrs[n].push(safeVal(row, n)); });
          });

          if (!xArr.length) {
            self._err(element, "No plottable data — confirm the X field contains values.");
            done(); return;
          }

          // ---- Measure traces ----
          var traces = [];
          measNames.forEach(function (name, idx) {
            var meta  = allF.find(function (f) { return f.name === name; });
            var label = meta ? fieldLabel(meta) : name;
            var color = LINE_PALETTE[idx % LINE_PALETTE.length];
            var t = {
              type: useWebGL ? "scattergl" : "scatter",
              mode: traceType, name: label,
              x: xArr, y: yArrs[name],
              opacity: lineOp,
              yaxis: (dualAxis && idx > 0) ? "y2" : "y",
              hovertemplate: "<b>" + label + "</b>: %{y}<br>%{x}<extra></extra>",
            };
            if (traceType !== "markers") t.line   = { color: color, width: lineWidth };
            if (traceType !== "lines")   t.marker = { color: color, size: pointSize };
            traces.push(t);
          });

          // ---- Process band groups ----
          self._allBandShapes   = {};
          self._bandColorMaps   = {};
          self._bandCatTraceIdx = {};
          var allShapes = [];

          groups.forEach(function (g) {
            var palette  = GROUP_PALETTES[g.idx % GROUP_PALETTES.length];
            var bands    = extractBands(data, g.startField, g.endField, g.catField);
            var cats     = bands.map(function (b) { return b.category; });
            var colorMap = buildColorMap(cats, palette);

            self._bandColorMaps[g.idx] = colorMap;

            // Per-category toggle state — reset only when category set changes
            var catKey = cats.slice().sort().join("\x00");
            if (!self._activeCats[g.idx] || self._activeCats[g.idx].__key !== catKey) {
              var state = { __key: catKey };
              cats.forEach(function (c) { state[c] = true; });
              self._activeCats[g.idx] = state;
            }

            // Store all shapes for this group
            self._allBandShapes[g.idx] = bands.map(function (band) {
              return { category: band.category, shape: makeShape(band, colorMap[band.category], bandOp, showBorder) };
            });

            // Only include shapes if group is active
            if (self._activeGroups[g.idx] !== false) {
              allShapes = allShapes.concat(
                activeShapes(self._allBandShapes[g.idx], self._activeCats[g.idx])
              );
            }

            // Legend dummy traces — only for active groups
            if (self._activeGroups[g.idx] !== false) {
              Object.keys(colorMap).forEach(function (cat) {
                if (cat === "__key") return;
                var isOn  = self._activeCats[g.idx][cat] !== false;
                var rgba  = colorMap[cat];
                self._bandCatTraceIdx[g.idx + ":" + cat] = traces.length;
                traces.push({
                  type: "scatter", mode: "markers",
                  name: cat,
                  legendgroup: "bg_" + g.idx,
                  legendgrouptitle: { text: g.label, font: { size: 11, color: "#6b7280" } },
                  x: [null], y: [null],
                  marker: {
                    color:  rgba + (isOn ? "0.75)" : "0.2)"),
                    size:   12,
                    symbol: isOn ? "square" : "square-open",
                  },
                  showlegend: true,
                  hoverinfo: "skip",
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

          var layout = {
            margin: { t: 16, r: dualAxis ? 80 : 32, b: config.show_legend !== false ? 80 : 48, l: 64 },
            paper_bgcolor: "rgba(0,0,0,0)", plot_bgcolor: "rgba(0,0,0,0)",
            shapes: allShapes,
            showlegend: config.show_legend !== false,
            legend: { orientation: "h", x: 0, y: -0.2, font: { size: 11 }, traceorder: "grouped" },
            xaxis: {
              title: { text: xMeta ? fieldLabel(xMeta) : xField, font: { size: 12 } },
              type: "date", gridcolor: "#e5e7eb", linecolor: "#d1d5db", automargin: true,
            },
            yaxis: {
              title: { text: (config.y_axis_label || "").trim() || autoYLabel, font: { size: 12 } },
              gridcolor: "#e5e7eb", linecolor: "#d1d5db", zerolinecolor: "#d1d5db", automargin: true,
            },
            hoverlabel: { bgcolor: "#1f2937", font: { color: "#f9fafb", size: 12 }, bordercolor: "#374151" },
            hovermode: "x unified",
          };

          if (dualAxis) {
            layout.yaxis2 = {
              title: { text: (config.y2_axis_label || "").trim(), font: { size: 12 } },
              overlaying: "y", side: "right", gridcolor: "transparent",
              linecolor: "#d1d5db", automargin: true,
            };
          }

          // Cache inputs needed to re-render on dropdown toggle
          self._renderCache = {
            traces: traces, layout: layout,
            allBandShapes: self._allBandShapes,
            bandColorMaps: self._bandColorMaps,
            bandCatTraceIdx: self._bandCatTraceIdx,
            groups: groups,
          };

          Plotly.react(self._chartDiv, traces, layout, {
            responsive: true, displayModeBar: true,
            modeBarButtonsToRemove: ["sendDataToCloud", "lasso2d", "select2d"],
            displaylogo: false,
            toImageButtonOptions: { format: "png", scale: 2 },
          });

          // ---- Dropdown ----
          buildDropdown(self._controlBar, groups, self._activeGroups, function (groupIdx, isNowOn) {
            self._activeGroups[groupIdx] = isNowOn;
            self._rerender();
          });

          // ---- Legend click handler ----
          self._attachLegendHandlers(groups, bandOp, showBorder);

        } catch (err) {
          self._err(element, "Visualization error: " + err.message);
          console.error("[plotly_timeseries_bands]", err);
        }
        done();
      });
    },

    // -----------------------------------------------------------------------
    // _rerender — fast re-render from cache (used by dropdown toggle)
    // -----------------------------------------------------------------------
    _rerender: function () {
      var self = this;
      var cache = self._renderCache;
      if (!cache) return;

      var groups  = cache.groups;
      var allShapes = [];
      var traces  = cache.traces.slice(0, cache.traces.length); // shallow copy

      // Remove all old band dummy traces (keep measure traces at the front)
      var measTraceCount = traces.filter(function (t) { return !t.legendgroup; }).length;
      traces = traces.slice(0, measTraceCount);

      // Rebuild dummy traces and shapes from current active state
      self._bandCatTraceIdx = {};

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

      Plotly.react(self._chartDiv, traces, Object.assign({}, cache.layout, { shapes: allShapes }), {
        responsive: true, displayModeBar: true,
        modeBarButtonsToRemove: ["sendDataToCloud", "lasso2d", "select2d"],
        displaylogo: false,
      });

      // Re-attach handlers with fresh state
      self._attachLegendHandlers(
        groups,
        cache.layout.shapes ? 0.18 : 0.18, // bandOp
        false
      );
    },

    // -----------------------------------------------------------------------
    // _attachLegendHandlers
    // -----------------------------------------------------------------------
    _attachLegendHandlers: function (groups, bandOp, showBorder) {
      var self = this;

      self._chartDiv.removeAllListeners("plotly_legendclick");
      self._chartDiv.removeAllListeners("plotly_legenddoubleclick");

      self._chartDiv.on("plotly_legendclick", function (eventData) {
        var clickedName = eventData.trace.name;
        var lg          = (eventData.trace.legendgroup || "");
        if (!lg.startsWith("bg_")) return; // measure trace — default behavior

        var groupIdx = parseInt(lg.replace("bg_", ""), 10);
        var catState = self._activeCats[groupIdx];
        if (!catState || !catState.hasOwnProperty(clickedName)) return;

        catState[clickedName] = !catState[clickedName];
        self._rerender();
        return false;
      });

      self._chartDiv.on("plotly_legenddoubleclick", function (eventData) {
        var lg = (eventData.trace.legendgroup || "");
        if (!lg.startsWith("bg_")) return;

        var groupIdx  = parseInt(lg.replace("bg_", ""), 10);
        var catState  = self._activeCats[groupIdx];
        var clickedName = eventData.trace.name;
        if (!catState) return;

        var realCats = Object.keys(catState).filter(function (k) { return k !== "__key"; });
        var alreadySolo = realCats.every(function (c) {
          return c === clickedName ? catState[c] !== false : catState[c] === false;
        });

        realCats.forEach(function (c) {
          catState[c] = alreadySolo ? true : (c === clickedName);
        });

        self._rerender();
        return false;
      });
    },

    // -----------------------------------------------------------------------
    _err: function (element, msg) {
      var d = document.createElement("div");
      d.style.cssText = "padding:16px;color:#b91c1c;font-size:13px;font-family:sans-serif;";
      d.textContent = "⚠ " + msg;
      element.appendChild(d);
    },
  });
})();
