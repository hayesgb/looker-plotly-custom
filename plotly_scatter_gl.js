(function () {
  // ---------------------------------------------------------------------------
  // Plotly High-Performance Scatter (scattergl / WebGL)
  // Looker Custom Visualization
  //
  // Drop-in replacement for Looker's built-in scatter plot.
  // Uses Plotly scattergl (WebGL renderer) — handles 50k+ points cleanly.
  //
  // Field mapping defaults:
  //   X  → first measure
  //   Y  → second measure  (falls back to first dimension if only one measure)
  //   Color → optional third measure or any dimension
  //
  // Override any field via the viz config panel.
  //
  // IMPORTANT — Plotly dependency:
  // Do NOT load Plotly dynamically from within this file (CORS / CSP risk).
  // Instead, register the Plotly CDN URL in the Looker Admin viz Dependencies
  // field so Looker pre-loads it in its own context:
  //   https://cdn.plot.ly/plotly-2.27.0.min.js
  // ---------------------------------------------------------------------------

  function loadPlotly(callback) {
    // Plotly should already be present via the Looker Dependencies field.
    // This fallback handles local dev / test environments only.
    if (window.Plotly) {
      callback();
      return;
    }
    console.warn(
      "[plotly_scatter_gl] Plotly not found on window. " +
      "Add https://cdn.plot.ly/plotly-2.27.0.min.js to the " +
      "Dependencies field in Admin → Platform → Visualizations."
    );
    // Attempt dynamic load as last resort (may be blocked by Looker CSP)
    var script = document.createElement("script");
    script.src = "https://cdn.plot.ly/plotly-2.27.0.min.js";
    script.onload = callback;
    script.onerror = function () {
      console.error(
        "[plotly_scatter_gl] Failed to load Plotly. " +
        "Configure the Dependencies field in Looker Admin to resolve this."
      );
    };
    document.head.appendChild(script);
  }

  function fieldLabel(field) {
    return field.label_short || field.label || field.name;
  }

  function safeValue(row, fieldName) {
    return row[fieldName] && row[fieldName].value !== undefined
      ? row[fieldName].value
      : null;
  }

  // ---------------------------------------------------------------------------
  // Viz registration
  // ---------------------------------------------------------------------------
  looker.plugins.visualizations.add({
    id: "plotly_scatter_gl",
    label: "Plotly Scatter (High Performance)",

    // Config options exposed in the Looker viz panel
    options: {
      x_field: {
        type: "string",
        label: "X Field (Looker field name, e.g. view.field)",
        display: "text",
        default: "",
        section: "Field Mapping",
        order: 1,
      },
      y_field: {
        type: "string",
        label: "Y Field (Looker field name, e.g. view.field)",
        display: "text",
        default: "",
        section: "Field Mapping",
        order: 2,
      },
      color_field: {
        type: "string",
        label: "Color Field (optional)",
        display: "text",
        default: "",
        section: "Field Mapping",
        order: 3,
      },
      point_size: {
        type: "number",
        label: "Point Size",
        display: "range",
        min: 1,
        max: 16,
        step: 1,
        default: 5,
        section: "Style",
        order: 4,
      },
      opacity: {
        type: "number",
        label: "Opacity (0.1 – 1.0)",
        display: "range",
        min: 0.1,
        max: 1.0,
        step: 0.05,
        default: 0.75,
        section: "Style",
        order: 5,
      },
      point_color: {
        type: "string",
        label: "Point Color (hex, used when no Color Field set)",
        display: "text",
        default: "#2563eb",
        section: "Style",
        order: 6,
      },
      colorscale: {
        type: "string",
        label: "Color Scale (when Color Field is set)",
        display: "select",
        values: [
          { Viridis: "Viridis" },
          { Plasma: "Plasma" },
          { Cividis: "Cividis" },
          { Blues: "Blues" },
          { Reds: "Reds" },
          { RdBu: "RdBu" },
          { Turbo: "Turbo" },
        ],
        default: "Viridis",
        section: "Style",
        order: 7,
      },
      show_trendline: {
        type: "boolean",
        label: "Show Trendline (OLS)",
        default: false,
        section: "Style",
        order: 8,
      },
    },

    // Called once when the viz is first created
    create: function (element, config) {
      this._container = document.createElement("div");
      this._container.style.width = "100%";
      this._container.style.height = "100%";
      this._container.style.minHeight = "200px";
      element.style.overflow = "hidden";
      element.appendChild(this._container);
      this._errorEl = null;
    },

    // Called on every data/config update
    updateAsync: function (data, element, config, queryResponse, details, done) {
      var self = this;

      // Clear any previous error message
      if (self._errorEl) {
        self._errorEl.remove();
        self._errorEl = null;
      }

      loadPlotly(function () {
        try {
          var dims = queryResponse.fields.dimensions || [];
          var measures = queryResponse.fields.measures || [];
          var allFields = dims.concat(measures);

          // ---------------------------------------------------------------
          // Require at least 2 fields
          // ---------------------------------------------------------------
          if (allFields.length < 2) {
            self._showError(
              element,
              "Add at least 2 fields (measures or dimensions) to use this visualization."
            );
            done();
            return;
          }

          // ---------------------------------------------------------------
          // Resolve X / Y / Color fields
          // Priority: explicit config override → sensible default
          // Default:  X = measures[0], Y = measures[1] (or dims[0] fallback)
          // ---------------------------------------------------------------
          var xField =
            (config.x_field || "").trim() ||
            (measures.length >= 1 ? measures[0].name : dims[0].name);

          var yField =
            (config.y_field || "").trim() ||
            (measures.length >= 2
              ? measures[1].name
              : measures.length === 1
              ? measures[0].name
              : dims[1].name);

          var colorField = (config.color_field || "").trim() || null;

          // ---------------------------------------------------------------
          // Extract data arrays
          // ---------------------------------------------------------------
          var xArr = [],
            yArr = [],
            colorArr = [],
            tooltipArr = [];

          data.forEach(function (row) {
            var xVal = safeValue(row, xField);
            var yVal = safeValue(row, yField);

            // Skip rows with nulls in X or Y
            if (xVal === null || yVal === null) return;

            xArr.push(xVal);
            yArr.push(yVal);

            if (colorField) {
              colorArr.push(safeValue(row, colorField));
            }

            // Build tooltip from every field in the query
            tooltipArr.push(
              allFields
                .map(function (f) {
                  var v = safeValue(row, f.name);
                  return (
                    "<b>" + fieldLabel(f) + "</b>: " + (v !== null ? v : "—")
                  );
                })
                .join("<br>")
            );
          });

          if (xArr.length === 0) {
            self._showError(
              element,
              "No plottable data — check that X and Y fields contain numeric values."
            );
            done();
            return;
          }

          // ---------------------------------------------------------------
          // Build marker config
          // ---------------------------------------------------------------
          var marker = {
            size: config.point_size != null ? config.point_size : 5,
            opacity: config.opacity != null ? config.opacity : 0.75,
          };

          if (colorField && colorArr.length > 0) {
            marker.color = colorArr;
            marker.colorscale = config.colorscale || "Viridis";
            marker.showscale = true;
            marker.colorbar = {
              thickness: 14,
              len: 0.8,
              title: {
                text: fieldLabel(
                  allFields.find(function (f) {
                    return f.name === colorField;
                  }) || { name: colorField }
                ),
                side: "right",
              },
            };
          } else {
            marker.color = config.point_color || "#2563eb";
          }

          // ---------------------------------------------------------------
          // Primary scatter trace (WebGL)
          // ---------------------------------------------------------------
          var traces = [
            {
              type: "scattergl",
              mode: "markers",
              x: xArr,
              y: yArr,
              marker: marker,
              text: tooltipArr,
              hoverinfo: "text",
              name: "Data",
            },
          ];

          // ---------------------------------------------------------------
          // Optional OLS trendline (computed in JS, rendered as SVG line)
          // ---------------------------------------------------------------
          if (config.show_trendline && xArr.length > 1) {
            var trendLine = computeOLS(xArr, yArr);
            if (trendLine) {
              traces.push({
                type: "scatter", // SVG — just two points, negligible cost
                mode: "lines",
                x: [trendLine.x0, trendLine.x1],
                y: [trendLine.y0, trendLine.y1],
                line: { color: "#ef4444", width: 2, dash: "dash" },
                hoverinfo: "skip",
                name: "Trend",
              });
            }
          }

          // ---------------------------------------------------------------
          // Layout
          // ---------------------------------------------------------------
          var xMeta = allFields.find(function (f) {
            return f.name === xField;
          });
          var yMeta = allFields.find(function (f) {
            return f.name === yField;
          });

          var layout = {
            margin: { t: 24, r: colorField ? 80 : 24, b: 56, l: 64 },
            paper_bgcolor: "rgba(0,0,0,0)",
            plot_bgcolor: "rgba(0,0,0,0)",
            xaxis: {
              title: { text: xMeta ? fieldLabel(xMeta) : xField, font: { size: 12 } },
              gridcolor: "#e5e7eb",
              linecolor: "#d1d5db",
              zerolinecolor: "#d1d5db",
              automargin: true,
            },
            yaxis: {
              title: { text: yMeta ? fieldLabel(yMeta) : yField, font: { size: 12 } },
              gridcolor: "#e5e7eb",
              linecolor: "#d1d5db",
              zerolinecolor: "#d1d5db",
              automargin: true,
            },
            showlegend: false,
            hoverlabel: {
              bgcolor: "#1f2937",
              font: { color: "#f9fafb", size: 12 },
              bordercolor: "#374151",
            },
          };

          var plotConfig = {
            responsive: true,
            displayModeBar: true,
            modeBarButtonsToRemove: ["sendDataToCloud", "lasso2d", "select2d"],
            displaylogo: false,
            toImageButtonOptions: { format: "png", scale: 2 },
          };

          // react() efficiently diffs and re-renders (no full redraw on config change)
          Plotly.react(self._container, traces, layout, plotConfig);

        } catch (err) {
          self._showError(element, "Visualization error: " + err.message);
          console.error("[plotly_scatter_gl]", err);
        }

        done();
      });
    },

    // -----------------------------------------------------------------------
    // Helper: render an inline error message
    // -----------------------------------------------------------------------
    _showError: function (element, msg) {
      var div = document.createElement("div");
      div.style.cssText =
        "padding:16px;color:#b91c1c;font-size:13px;font-family:sans-serif;";
      div.textContent = "⚠ " + msg;
      element.appendChild(div);
      this._errorEl = div;
    },
  });

  // ---------------------------------------------------------------------------
  // Simple OLS trendline helper
  // Returns {x0, y0, x1, y1} spanning the data range, or null on failure.
  // ---------------------------------------------------------------------------
  function computeOLS(xArr, yArr) {
    var n = xArr.length;
    var sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;

    for (var i = 0; i < n; i++) {
      sumX += xArr[i];
      sumY += yArr[i];
      sumXY += xArr[i] * yArr[i];
      sumX2 += xArr[i] * xArr[i];
    }

    var denom = n * sumX2 - sumX * sumX;
    if (denom === 0) return null;

    var slope = (n * sumXY - sumX * sumY) / denom;
    var intercept = (sumY - slope * sumX) / n;

    var xMin = Math.min.apply(null, xArr);
    var xMax = Math.max.apply(null, xArr);

    return {
      x0: xMin,
      y0: slope * xMin + intercept,
      x1: xMax,
      y1: slope * xMax + intercept,
    };
  }
})();
