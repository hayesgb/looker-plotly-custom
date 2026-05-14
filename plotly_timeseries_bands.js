(function () {
  // ---------------------------------------------------------------------------
  // Plotly Time Series + Plot Bands
  // Looker Custom Visualization
  //
  // Features:
  //   - Multiple continuous measures on a shared time-series X axis
  //   - Each measure rendered as lines, scatter (WebGL), or lines+points
  //   - Categorical plot bands — colored background regions defined by
  //     a start timestamp, end timestamp, and a category field
  //   - Band categories are TOGGLEABLE via legend click — click to hide/show,
  //     dimmed legend entry indicates hidden state
  //   - Optional dual Y axis (first measure left, all others right)
  //   - Toggle state persists across config changes; resets on new data
  //
  // Field mapping:
  //   X        → time dimension (first dimension by default)
  //   Measures → all measures by default; override with comma-separated list
  //   Bands    → requires three fields: start_ts, end_ts, category
  //
  // IMPORTANT — Plotly dependency:
  //   Register the Plotly CDN URL in the Looker Admin viz Dependencies field:
  //   https://cdn.plot.ly/plotly-2.27.0.min.js
  // ---------------------------------------------------------------------------

  // Palette for plot bands — rgba base strings (opacity appended at runtime)
  var BAND_PALETTE = [
    "rgba(99,102,241,",   // indigo
    "rgba(249,115,22,",   // orange
    "rgba(20,184,166,",   // teal
    "rgba(244,63,94,",    // rose
    "rgba(234,179,8,",    // amber
    "rgba(168,85,247,",   // purple
    "rgba(34,197,94,",    // green
    "rgba(14,165,233,",   // sky
    "rgba(236,72,153,",   // pink
    "rgba(132,204,22,",   // lime
  ];

  // Solid palette for measure traces
  var LINE_PALETTE = [
    "#6366f1", "#f97316", "#14b8a6", "#f43f5e",
    "#eab308", "#a855f7", "#22c55e", "#0ea5e9",
    "#ec4899", "#84cc16",
  ];

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  function loadPlotly(callback) {
    if (window.Plotly) { callback(); return; }
    console.warn(
      "[plotly_timeseries_bands] Plotly not found on window. " +
      "Add https://cdn.plot.ly/plotly-2.27.0.min.js to the " +
      "Dependencies field in Admin → Platform → Visualizations."
    );
    var s = document.createElement("script");
    s.src = "https://cdn.plot.ly/plotly-2.27.0.min.js";
    s.onload = callback;
    s.onerror = function () {
      console.error("[plotly_timeseries_bands] Failed to load Plotly.");
    };
    document.head.appendChild(s);
  }

  function fieldLabel(field) {
    return field.label_short || field.label || field.name;
  }

  function safeVal(row, name) {
    return row[name] && row[name].value !== undefined ? row[name].value : null;
  }

  function parseList(str) {
    if (!str || !str.trim()) return [];
    return str.split(",").map(function (s) { return s.trim(); }).filter(Boolean);
  }

  // Assign each unique category a palette color; return { category: rgbaBase }
  function buildColorMap(categories) {
    var map = {}, idx = 0;
    categories.forEach(function (cat) {
      if (!map.hasOwnProperty(cat)) {
        map[cat] = BAND_PALETTE[idx++ % BAND_PALETTE.length];
      }
    });
    return map;
  }

  // Deduplicate band definitions from data rows
  function extractBands(data, startF, endF, catF) {
    var seen = {}, bands = [];
    data.forEach(function (row) {
      var s = safeVal(row, startF),
          e = safeVal(row, endF),
          c = safeVal(row, catF);
      if (s === null || e === null || c === null) return;
      var key = s + "\x00" + e + "\x00" + c;
      if (!seen[key]) {
        seen[key] = true;
        bands.push({ start: s, end: e, category: String(c) });
      }
    });
    return bands;
  }

  // Build shape objects for all bands, optionally filtering by active state
  function buildShapes(allBandShapes, activeCats) {
    return allBandShapes
      .filter(function (bs) { return activeCats[bs.category] !== false; })
      .map(function (bs) { return bs.shape; });
  }

  // ---------------------------------------------------------------------------
  // Visualization registration
  // ---------------------------------------------------------------------------

  looker.plugins.visualizations.add({
    id: "plotly_timeseries_bands",
    label: "Plotly Time Series + Plot Bands",

    options: {
      // ---- Field mapping ----
      x_field: {
        type: "string",
        label: "X (Time) Field",
        display: "text",
        default: "",
        placeholder: "e.g. events.timestamp",
        section: "Field Mapping",
        order: 1,
      },
      measure_fields: {
        type: "string",
        label: "Measure Fields (comma-separated; blank = all measures)",
        display: "text",
        default: "",
        placeholder: "e.g. events.power_kw, events.temp_f",
        section: "Field Mapping",
        order: 2,
      },
      band_start_field: {
        type: "string",
        label: "Plot Band — Start Timestamp Field",
        display: "text",
        default: "",
        placeholder: "e.g. events.period_start",
        section: "Field Mapping",
        order: 3,
      },
      band_end_field: {
        type: "string",
        label: "Plot Band — End Timestamp Field",
        display: "text",
        default: "",
        placeholder: "e.g. events.period_end",
        section: "Field Mapping",
        order: 4,
      },
      band_category_field: {
        type: "string",
        label: "Plot Band — Category Field (drives color)",
        display: "text",
        default: "",
        placeholder: "e.g. events.event_type",
        section: "Field Mapping",
        order: 5,
      },

      // ---- Trace style ----
      trace_type: {
        type: "string",
        label: "Trace Type",
        display: "select",
        values: [
          { Lines: "lines" },
          { "Scatter (WebGL)": "markers" },
          { "Lines + Points": "lines+markers" },
        ],
        default: "lines",
        section: "Trace Style",
        order: 6,
      },
      line_width: {
        type: "number",
        label: "Line Width",
        display: "range",
        min: 1,
        max: 8,
        step: 0.5,
        default: 2,
        section: "Trace Style",
        order: 7,
      },
      point_size: {
        type: "number",
        label: "Point Size (scatter / lines+points)",
        display: "range",
        min: 2,
        max: 14,
        step: 1,
        default: 4,
        section: "Trace Style",
        order: 8,
      },
      line_opacity: {
        type: "number",
        label: "Trace Opacity",
        display: "range",
        min: 0.2,
        max: 1.0,
        step: 0.05,
        default: 1.0,
        section: "Trace Style",
        order: 9,
      },

      // ---- Band style ----
      band_opacity: {
        type: "number",
        label: "Band Fill Opacity",
        display: "range",
        min: 0.05,
        max: 0.6,
        step: 0.05,
        default: 0.18,
        section: "Band Style",
        order: 10,
      },
      band_border: {
        type: "boolean",
        label: "Show Band Border Lines",
        default: false,
        section: "Band Style",
        order: 11,
      },

      // ---- Axes & legend ----
      use_dual_axis: {
        type: "boolean",
        label: "Dual Y Axis (first measure = left, rest = right)",
        default: false,
        section: "Axes & Legend",
        order: 12,
      },
      y_axis_label: {
        type: "string",
        label: "Left Y Axis Label (overrides auto)",
        display: "text",
        default: "",
        section: "Axes & Legend",
        order: 13,
      },
      y2_axis_label: {
        type: "string",
        label: "Right Y Axis Label (dual axis only)",
        display: "text",
        default: "",
        section: "Axes & Legend",
        order: 14,
      },
      show_legend: {
        type: "boolean",
        label: "Show Legend",
        default: true,
        section: "Axes & Legend",
        order: 15,
      },
    },

    create: function (element) {
      this._container = document.createElement("div");
      this._container.style.cssText = "width:100%;height:100%;min-height:200px;";
      element.style.overflow = "hidden";
      element.appendChild(this._container);

      // Persistent band toggle state — survives config-only re-renders
      // _activeCats:      { category: bool }   — true = visible
      // _catSetKey:       string               — fingerprint to detect new data
      // _allBandShapes:   [{ category, shape }] — full shape list for rebuild
      // _bandColorMap:    { category: rgbaBase }
      // _bandCatTraceIdx: { category: traceIdx } — for restyle calls
      this._activeCats      = {};
      this._catSetKey       = null;
      this._allBandShapes   = [];
      this._bandColorMap    = {};
      this._bandCatTraceIdx = {};
    },

    updateAsync: function (data, element, config, queryResponse, details, done) {
      var self = this;

      loadPlotly(function () {
        try {
          var dims = queryResponse.fields.dimensions || [];
          var meas = queryResponse.fields.measures   || [];
          var allF = dims.concat(meas);

          if (allF.length < 1) {
            self._err(element, "Add at least one field to use this visualization.");
            done(); return;
          }

          // ----------------------------------------------------------------
          // Resolve fields from config
          // ----------------------------------------------------------------
          var xField = (config.x_field || "").trim() ||
            (dims.length ? dims[0].name : allF[0].name);

          var measNames = parseList(config.measure_fields);
          if (!measNames.length) {
            measNames = meas.map(function (f) { return f.name; });
          }

          var bandStart = (config.band_start_field    || "").trim() || null;
          var bandEnd   = (config.band_end_field      || "").trim() || null;
          var bandCat   = (config.band_category_field || "").trim() || null;
          var hasBands  = !!(bandStart && bandEnd && bandCat);

          var traceType  = config.trace_type  || "lines";
          var useWebGL   = traceType === "markers";
          var dualAxis   = !!(config.use_dual_axis && measNames.length > 1);
          var lineWidth  = config.line_width   != null ? config.line_width   : 2;
          var pointSize  = config.point_size   != null ? config.point_size   : 4;
          var lineOp     = config.line_opacity != null ? config.line_opacity : 1.0;
          var bandOp     = config.band_opacity != null ? config.band_opacity : 0.18;
          var showBorder = !!config.band_border;

          // ----------------------------------------------------------------
          // Build time-series arrays
          // ----------------------------------------------------------------
          var xArr  = [];
          var yArrs = {};
          measNames.forEach(function (n) { yArrs[n] = []; });

          data.forEach(function (row) {
            var xv = safeVal(row, xField);
            if (xv === null) return;
            xArr.push(xv);
            measNames.forEach(function (n) {
              yArrs[n].push(safeVal(row, n));
            });
          });

          if (!xArr.length) {
            self._err(element, "No plottable data — confirm the X field contains values.");
            done(); return;
          }

          // ----------------------------------------------------------------
          // Build measure traces
          // ----------------------------------------------------------------
          var traces = [];

          measNames.forEach(function (name, idx) {
            var meta  = allF.find(function (f) { return f.name === name; });
            var label = meta ? fieldLabel(meta) : name;
            var color = LINE_PALETTE[idx % LINE_PALETTE.length];
            var onY2  = dualAxis && idx > 0;

            var trace = {
              type: useWebGL ? "scattergl" : "scatter",
              mode: traceType,
              name: label,
              x: xArr,
              y: yArrs[name],
              opacity: lineOp,
              yaxis: onY2 ? "y2" : "y",
              hovertemplate: "<b>" + label + "</b>: %{y}<br>%{x}<extra></extra>",
            };

            if (traceType !== "markers") {
              trace.line = { color: color, width: lineWidth };
            }
            if (traceType !== "lines") {
              trace.marker = { color: color, size: pointSize };
            }

            traces.push(trace);
          });

          // ----------------------------------------------------------------
          // Process plot bands
          // ----------------------------------------------------------------
          var shapes = [];
          self._allBandShapes   = [];
          self._bandColorMap    = {};
          self._bandCatTraceIdx = {};

          if (hasBands) {
            var bands    = extractBands(data, bandStart, bandEnd, bandCat);
            var cats     = bands.map(function (b) { return b.category; });
            var colorMap = buildColorMap(cats);
            self._bandColorMap = colorMap;

            // ---- Reset toggle state only when category set changes ----
            // This preserves user's toggle choices across config-only re-renders
            var newCatKey = Object.keys(colorMap).sort().join("\x00");
            if (self._catSetKey !== newCatKey) {
              self._activeCats = {};
              Object.keys(colorMap).forEach(function (cat) {
                self._activeCats[cat] = true;
              });
              self._catSetKey = newCatKey;
            }

            // ---- Build full shape list (all bands, all categories) ----
            bands.forEach(function (band) {
              var rgba  = colorMap[band.category];
              var shape = {
                type:      "rect",
                xref:      "x",
                yref:      "paper",
                x0:        band.start,
                x1:        band.end,
                y0:        0,
                y1:        1,
                fillcolor: rgba + bandOp + ")",
                line: {
                  width: showBorder ? 1 : 0,
                  color: showBorder ? rgba + "0.6)" : "transparent",
                },
                layer: "below",
              };
              self._allBandShapes.push({ category: band.category, shape: shape });
            });

            // Only render shapes for currently active categories
            shapes = buildShapes(self._allBandShapes, self._activeCats);

            // ---- Band legend dummy traces ----
            // Track trace indices so restyle calls know which trace to update
            Object.keys(colorMap).forEach(function (cat) {
              var isActive = self._activeCats[cat] !== false;
              var rgba     = colorMap[cat];
              self._bandCatTraceIdx[cat] = traces.length;
              traces.push({
                type: "scatter",
                mode: "markers",
                name: cat,
                x: [null],
                y: [null],
                marker: {
                  // Active: solid square; inactive: faded with strikethrough feel
                  color:   rgba + (isActive ? "0.75)" : "0.2)"),
                  size:    12,
                  symbol:  isActive ? "square" : "square-open",
                },
                showlegend: true,
                hoverinfo: "skip",
              });
            });
          }

          // ----------------------------------------------------------------
          // Layout
          // ----------------------------------------------------------------
          var xMeta = allF.find(function (f) { return f.name === xField; });

          var autoYLabel = "";
          if (measNames.length === 1) {
            var ym = allF.find(function (f) { return f.name === measNames[0]; });
            if (ym) autoYLabel = fieldLabel(ym);
          }

          var layout = {
            margin: {
              t: 24,
              r: dualAxis ? 80 : 32,
              b: config.show_legend !== false ? 72 : 48,
              l: 64,
            },
            paper_bgcolor: "rgba(0,0,0,0)",
            plot_bgcolor:  "rgba(0,0,0,0)",
            shapes: shapes,
            showlegend: config.show_legend !== false,
            legend: {
              orientation: "h",
              x: 0,
              y: -0.18,
              font: { size: 11 },
              traceorder: "normal",
            },
            xaxis: {
              title: {
                text: xMeta ? fieldLabel(xMeta) : xField,
                font: { size: 12 },
              },
              type: "date",
              gridcolor: "#e5e7eb",
              linecolor: "#d1d5db",
              automargin: true,
            },
            yaxis: {
              title: {
                text: (config.y_axis_label || "").trim() || autoYLabel,
                font: { size: 12 },
              },
              gridcolor: "#e5e7eb",
              linecolor: "#d1d5db",
              zerolinecolor: "#d1d5db",
              automargin: true,
            },
            hoverlabel: {
              bgcolor: "#1f2937",
              font: { color: "#f9fafb", size: 12 },
              bordercolor: "#374151",
            },
            hovermode: "x unified",
          };

          if (dualAxis) {
            layout.yaxis2 = {
              title: {
                text: (config.y2_axis_label || "").trim(),
                font: { size: 12 },
              },
              overlaying: "y",
              side: "right",
              gridcolor: "transparent",
              linecolor: "#d1d5db",
              automargin: true,
            };
          }

          var plotCfg = {
            responsive: true,
            displayModeBar: true,
            modeBarButtonsToRemove: ["sendDataToCloud", "lasso2d", "select2d"],
            displaylogo: false,
            toImageButtonOptions: { format: "png", scale: 2 },
          };

          Plotly.react(self._container, traces, layout, plotCfg);

          // ----------------------------------------------------------------
          // Legend click — intercept clicks on band category entries
          //
          // Plotly's default legendclick shows/hides the *trace* itself.
          // Band categories are backed by invisible dummy traces — we don't
          // want to hide those. Instead we toggle the corresponding shapes.
          //
          // Returning false from the handler prevents Plotly's default action.
          // ----------------------------------------------------------------

          // Remove any previous listener to avoid stacking handlers
          self._container.removeAllListeners("plotly_legendclick");
          self._container.removeAllListeners("plotly_legenddoubleclick");

          self._container.on("plotly_legendclick", function (eventData) {
            var clickedName = eventData.trace.name;

            // Not a band category — let Plotly handle normally
            if (!self._bandCatTraceIdx.hasOwnProperty(clickedName)) {
              return; // default behavior
            }

            // Toggle active state
            self._activeCats[clickedName] = !self._activeCats[clickedName];
            var isNowActive = self._activeCats[clickedName];
            var rgba        = self._bandColorMap[clickedName];
            var traceIdx    = self._bandCatTraceIdx[clickedName];

            // Rebuild and apply the filtered shapes
            Plotly.relayout(self._container, {
              shapes: buildShapes(self._allBandShapes, self._activeCats),
            });

            // Update the dummy trace marker to reflect on/off state visually
            Plotly.restyle(self._container, {
              "marker.color":  [rgba + (isNowActive ? "0.75)" : "0.2)")],
              "marker.symbol": [isNowActive ? "square" : "square-open"],
            }, [traceIdx]);

            return false; // Prevent Plotly's default trace hide/show
          });

          // Double-click on a band legend entry: make it the only visible band
          // (mirrors Plotly's standard isolate behavior for regular traces)
          self._container.on("plotly_legenddoubleclick", function (eventData) {
            var clickedName = eventData.trace.name;

            if (!self._bandCatTraceIdx.hasOwnProperty(clickedName)) {
              return; // default behavior for measure traces
            }

            // Check if this category is already isolated (all others off)
            var allCats      = Object.keys(self._activeCats);
            var alreadySolo  = allCats.every(function (cat) {
              return cat === clickedName
                ? self._activeCats[cat] !== false
                : self._activeCats[cat] === false;
            });

            if (alreadySolo) {
              // Second double-click: restore all
              allCats.forEach(function (cat) { self._activeCats[cat] = true; });
            } else {
              // Isolate: only this category visible
              allCats.forEach(function (cat) {
                self._activeCats[cat] = (cat === clickedName);
              });
            }

            // Rebuild shapes
            Plotly.relayout(self._container, {
              shapes: buildShapes(self._allBandShapes, self._activeCats),
            });

            // Update all dummy trace markers
            allCats.forEach(function (cat) {
              var isActive = self._activeCats[cat];
              var traceIdx = self._bandCatTraceIdx[cat];
              var rgba     = self._bandColorMap[cat];
              Plotly.restyle(self._container, {
                "marker.color":  [rgba + (isActive ? "0.75)" : "0.2)")],
                "marker.symbol": [isActive ? "square" : "square-open"],
              }, [traceIdx]);
            });

            return false;
          });

        } catch (err) {
          self._err(element, "Visualization error: " + err.message);
          console.error("[plotly_timeseries_bands]", err);
        }

        done();
      });
    },

    _err: function (element, msg) {
      var d = document.createElement("div");
      d.style.cssText =
        "padding:16px;color:#b91c1c;font-size:13px;font-family:sans-serif;";
      d.textContent = "⚠ " + msg;
      element.appendChild(d);
    },
  });
})();
