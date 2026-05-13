# Plotly Scatter GL — Looker Implementation Guide

## What this does
Replaces Looker's SVG-based scatter plot with a WebGL renderer (Plotly `scattergl`).
Handles 5k–50k+ data points without the DOM node bottleneck. Includes optional OLS
trendline, configurable color scales, and per-tile field mapping overrides.

---

## Step 1 — Host the JS file

You need the file accessible at a public HTTPS URL. Two options:

### Option A: GitHub (simplest)
1. Create a public GitHub repo (or use an existing one).
2. Commit `plotly_scatter_gl.js` to it.
3. Go to the file on GitHub → click **Raw**.
4. Copy the raw URL, e.g.:
   ```
   https://raw.githubusercontent.com/YOUR_ORG/YOUR_REPO/main/plotly_scatter_gl.js
   ```
5. Use this URL in Step 2.

> **Note:** GitHub raw URLs can have latency. For production, serve via
> `cdn.jsdelivr.net` instead:
> `https://cdn.jsdelivr.net/gh/YOUR_ORG/YOUR_REPO@main/plotly_scatter_gl.js`

### Option B: GCS Bucket (better for Carrier Energy / GCP stack)
1. Upload `plotly_scatter_gl.js` to a GCS bucket.
2. Make the object **publicly readable** (uniform bucket-level access or ACL).
3. Your URL will be:
   ```
   https://storage.googleapis.com/YOUR_BUCKET/plotly_scatter_gl.js
   ```
4. Use this URL in Step 2.

---

## Step 2 — Register in Looker Admin

Requires Looker Admin access.

1. Navigate to **Admin → Platform → Visualizations**.
2. Click **Add Visualization**.
3. Fill in the fields:

   | Field  | Value                                          |
   |--------|------------------------------------------------|
   | ID     | `plotly_scatter_gl`                            |
   | Label  | `Plotly Scatter (High Performance)`            |
   | Main   | *(your hosted URL from Step 1)*                |

4. Click **Save**. No restart required.

---

## Step 3 — Switch existing scatter tiles

Your underlying queries, LookML, and field definitions do not change.
You are only swapping the rendering layer.

For each scatter plot tile you want to upgrade:

1. Open the dashboard → click **Edit Dashboard**.
2. On the tile, click **⋮ → Edit**.
3. In the **Visualization** panel, scroll to find **Plotly Scatter (High Performance)**.
4. Select it. The chart will re-render immediately using WebGL.
5. Check axis labels — they auto-populate from your field metadata.
6. If X/Y fields didn't auto-map correctly, see Field Mapping below.
7. Click **Save** on the tile, then **Save** the dashboard.

---

## Step 4 — Field Mapping (per tile)

The viz uses sensible defaults so most tiles require no manual mapping:

| Slot   | Default behavior                                        |
|--------|---------------------------------------------------------|
| X      | First measure in the query                              |
| Y      | Second measure (falls back to first dimension if needed)|
| Color  | Not set — all points render in a single color           |

**To override**, open the tile in edit mode → **Visualization tab → Field Mapping**:

- **X Field** — paste the Looker field name, e.g. `hvac_units.runtime_hours`
- **Y Field** — e.g. `hvac_units.energy_kwh`
- **Color Field** — e.g. `hvac_units.efficiency_rating` or a dimension like
  `hvac_units.unit_type`

> Find field names in the Explore by hovering over the field pill —
> it shows `view_name.field_name`.

---

## Config options reference

| Option           | Default     | Description                                             |
|------------------|-------------|---------------------------------------------------------|
| X Field          | *(auto)*    | Looker field name for X axis                            |
| Y Field          | *(auto)*    | Looker field name for Y axis                            |
| Color Field      | *(none)*    | Optional field — enables color scale                    |
| Point Size       | 5           | Marker size in pixels (1–16)                            |
| Opacity          | 0.75        | Marker opacity (0.1–1.0)                                |
| Point Color      | `#2563eb`   | Hex color when no Color Field is set                    |
| Color Scale      | Viridis     | Gradient when Color Field is active                     |
| Show Trendline   | Off         | Adds an OLS regression line (dashed red)                |

---

## Troubleshooting

**Chart doesn't appear / blank tile**
- Check the browser console for errors (F12).
- Confirm the hosted JS URL returns the file (open it in a new tab).
- Verify the CDN Plotly URL is reachable from your network.

**"Add at least 2 fields" error**
- The underlying query has fewer than 2 fields. Add a second measure or dimension.

**X/Y mapped to wrong fields**
- Use the Field Mapping overrides in the viz config panel.
- Field names are case-sensitive — copy from the Explore, don't type from memory.

**Points not visible but no error**
- Your X or Y field likely contains nulls for all rows at the current filter state.

**Trendline not appearing**
- Requires at least 2 non-null data points and Show Trendline toggled on.

---

## Rollback

To revert a tile to the built-in scatter:
1. Edit the tile → Visualization tab → select **Scatter**.
2. Remap X/Y as needed (same field remapping exercise in reverse).

To remove the custom viz entirely:
**Admin → Platform → Visualizations → Delete** next to `plotly_scatter_gl`.
This does not affect tiles already reverted to built-in scatter.
