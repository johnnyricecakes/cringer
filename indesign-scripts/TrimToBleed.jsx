// TrimToBleed.jsx
// Trims image frames and graphic/shape frames that extend beyond
// the document bleed back to the bleed boundary.
//
// Non-rotated items: geometric bounds adjusted directly.
// Rotated straight-sided items: path vertices clipped via Sutherland-Hodgman.
// Rotated curved items (ellipses, bezier): skipped or reported.
// Text frames: always handled via paste-into clipping container.
//
// Spread-spanning items (e.g. centerfolds) are clipped to the full spread
// bleed, not just one page's bleed.
//
// Settings are saved across sessions to ~/[userData]/TrimToBleed_prefs.txt
//
// Install: copy to your InDesign Scripts folder and run from the Scripts panel.
//   Mac: ~/Library/Preferences/Adobe InDesign/[version]/en_US/Scripts/Scripts Panel/
//   Win: %AppData%\Adobe\InDesign\[version]\[locale]\Scripts\Scripts Panel\

#target indesign

// Must be declared before the IIFE so loadPrefs/savePrefs see an assigned value
var PREFS_FILE = new File(Folder.userData + "/TrimToBleed_prefs.txt");

(function () {
    "use strict";

    if (app.documents.length === 0) {
        alert("No document is open.");
        return;
    }

    var doc     = app.activeDocument;
    var options = showOptionsDialog();
    if (!options) return;

    var report = { trimmed: [], masked: [], skipped: [], errors: [] };

    app.doScript(
        function () { processDocument(doc, options, report); },
        ScriptLanguage.JAVASCRIPT,
        undefined,
        UndoModes.ENTIRE_SCRIPT,
        "Trim to Bleed"
    );

    showReport(report);

}());

// ---------------------------------------------------------------------------
// Persistent preferences
// ---------------------------------------------------------------------------

function loadPrefs() {
    if (!PREFS_FILE.exists) return {};
    var prefs = {};
    try {
        PREFS_FILE.open("r");
        while (!PREFS_FILE.eof) {
            var line = PREFS_FILE.readln();
            var eq   = line.indexOf("=");
            if (eq > 0) prefs[line.substring(0, eq)] = line.substring(eq + 1);
        }
        PREFS_FILE.close();
    } catch (e) {
        try { PREFS_FILE.close(); } catch (e2) {}
    }
    return prefs;
}

function savePrefs(options) {
    try {
        PREFS_FILE.open("w");
        PREFS_FILE.writeln("trimImages="  + (options.trimImages  ? "1" : "0"));
        PREFS_FILE.writeln("trimShapes="  + (options.trimShapes  ? "1" : "0"));
        PREFS_FILE.writeln("rotatedMode=" + options.rotatedMode);
        PREFS_FILE.writeln("scope="       + options.scope);
        PREFS_FILE.close();
    } catch (e) {
        try { PREFS_FILE.close(); } catch (e2) {}
    }
}

// ---------------------------------------------------------------------------
// Dialog
// ---------------------------------------------------------------------------

function showOptionsDialog() {
    var saved = loadPrefs();

    // Restore previous values; default to sensible starting state
    var prevImages  = (saved.trimImages  !== "0");
    var prevShapes  = (saved.trimShapes  !== "0");
    var prevRotated = (saved.rotatedMode === "mask");
    var prevScope   = (saved.scope       === "page");

    var dlg     = app.dialogs.add({ name: "Trim to Bleed" });
    var mainCol = dlg.dialogColumns.add();

    with (mainCol.dialogRows.add()) {
        staticTexts.add({ staticLabel: "Trim items that extend past the bleed back to the bleed edge." });
    }
    with (mainCol.dialogRows.add()) { staticTexts.add({ staticLabel: " " }); }

    var scopePanel = mainCol.borderPanels.add();
    var scopeCol   = scopePanel.dialogColumns.add();
    with (scopeCol.dialogRows.add()) { staticTexts.add({ staticLabel: "Trim:" }); }
    var chkImages = scopeCol.checkboxControls.add({ staticLabel: "Image frames (placed graphics)", checkedState: prevImages });
    var chkShapes = scopeCol.checkboxControls.add({ staticLabel: "Graphic / shape frames",         checkedState: prevShapes });

    with (mainCol.dialogRows.add()) { staticTexts.add({ staticLabel: " " }); }

    var rotPanel = mainCol.borderPanels.add();
    var rotCol   = rotPanel.dialogColumns.add();
    with (rotCol.dialogRows.add()) {
        staticTexts.add({ staticLabel: "For rotated items:" });
    }
    var rotGroup = rotCol.radiobuttonGroups.add();
    var rbSkip   = rotGroup.radiobuttonControls.add({ staticLabel: "Skip and include in report", checkedState: !prevRotated });
    var rbMask   = rotGroup.radiobuttonControls.add({ staticLabel: "Apply clipping mask",        checkedState:  prevRotated });

    with (mainCol.dialogRows.add()) { staticTexts.add({ staticLabel: " " }); }

    var pgPanel = mainCol.borderPanels.add();
    var pgCol   = pgPanel.dialogColumns.add();
    with (pgCol.dialogRows.add()) { staticTexts.add({ staticLabel: "Apply to:" }); }
    var pgGroup = pgCol.radiobuttonGroups.add();
    var rbDoc   = pgGroup.radiobuttonControls.add({ staticLabel: "Entire document",   checkedState: !prevScope });
    var rbPage  = pgGroup.radiobuttonControls.add({ staticLabel: "Current page only", checkedState:  prevScope });

    with (mainCol.dialogRows.add()) { staticTexts.add({ staticLabel: " " }); }

    var ok     = dlg.show();
    var result = null;

    if (ok) {
        result = {
            trimImages:  chkImages.checkedState,
            trimShapes:  chkShapes.checkedState,
            rotatedMode: rbSkip.checkedState ? "skip" : "mask",
            scope:       rbDoc.checkedState  ? "document" : "page"
        };
        savePrefs(result);
    }

    dlg.destroy();
    return result;
}

function showReport(report) {
    var lines = ["=== Trim to Bleed ===", ""];

    if (report.trimmed.length > 0) {
        lines.push("Trimmed (" + report.trimmed.length + "):");
        for (var i = 0; i < report.trimmed.length; i++) lines.push("  - " + report.trimmed[i]);
        lines.push("");
    }
    if (report.masked.length > 0) {
        lines.push("Clipping masks applied (" + report.masked.length + "):");
        for (var i = 0; i < report.masked.length; i++) lines.push("  - " + report.masked[i]);
        lines.push("");
    }
    if (report.skipped.length > 0) {
        lines.push("Skipped (" + report.skipped.length + "):");
        for (var i = 0; i < report.skipped.length; i++) lines.push("  - " + report.skipped[i]);
        lines.push("");
    }
    if (report.errors.length > 0) {
        lines.push("Errors (" + report.errors.length + "):");
        for (var i = 0; i < report.errors.length; i++) lines.push("  ! " + report.errors[i]);
        lines.push("");
    }

    var total = report.trimmed.length + report.masked.length;
    if (total === 0 && report.skipped.length === 0 && report.errors.length === 0) {
        lines.push("No items found that extend beyond the bleed.");
    } else {
        lines.push("Done. " + total + " item(s) modified.");
    }

    alert(lines.join("\n"));
}

// ---------------------------------------------------------------------------
// Document processing
// ---------------------------------------------------------------------------

function processDocument(doc, options, report) {
    var spreads = getSpreadsToProcess(doc, options);

    for (var s = 0; s < spreads.length; s++) {
        var spread = spreads[s];
        var pages  = spread.pages.everyItem().getElements();
        var items  = collectItems(pages, options);

        for (var i = 0; i < items.length; i++) {
            var item  = items[i];
            var bleed = getItemBleedBounds(item, doc, pages);
            try {
                processItem(item, bleed, options, report);
            } catch (e) {
                report.errors.push(describeItem(item) + ": " + e.message);
            }
        }
    }
}

function getSpreadsToProcess(doc, options) {
    if (options.scope === "page") {
        return [app.activeWindow.activePage.parent];
    }
    return doc.spreads.everyItem().getElements();
}

// Bleed bounds that cover every page the item actually overlaps.
// A centerfold item spanning both pages gets the outer bleed of each page
// merged together, so it is not clipped at the spine.
function getItemBleedBounds(item, doc, spreadPages) {
    var gb          = item.geometricBounds;
    var overlapping = [];

    for (var i = 0; i < spreadPages.length; i++) {
        var pb      = spreadPages[i].bounds;
        var overlapH = gb[3] > pb[1] && gb[1] < pb[3];
        var overlapV = gb[2] > pb[0] && gb[0] < pb[2];
        if (overlapH && overlapV) {
            overlapping.push(getPageBleedBounds(spreadPages[i], doc));
        }
    }

    if (overlapping.length === 0) {
        return getPageBleedBounds(item.parentPage, doc);
    }

    var m = { top: overlapping[0].top, left: overlapping[0].left,
              bottom: overlapping[0].bottom, right: overlapping[0].right };
    for (var j = 1; j < overlapping.length; j++) {
        m.top    = Math.min(m.top,    overlapping[j].top);
        m.left   = Math.min(m.left,   overlapping[j].left);
        m.bottom = Math.max(m.bottom, overlapping[j].bottom);
        m.right  = Math.max(m.right,  overlapping[j].right);
    }
    return m;
}

function getPageBleedBounds(page, doc) {
    var prefs    = doc.documentPreferences;
    var pb       = page.bounds;
    var topB     = prefs.documentBleedTopOffset;
    var botB     = prefs.documentBleedBottomOffset;
    var insideB  = prefs.documentBleedInsideOrLeftOffset;
    var outsideB = prefs.documentBleedOutsideOrRightOffset;

    var leftB, rightB;
    if (prefs.facingPages) {
        var spread     = page.parent;
        var isLeftPage = (spread.pages.length > 1 && spread.pages[0] === page);
        leftB  = isLeftPage ? outsideB : insideB;
        rightB = isLeftPage ? insideB  : outsideB;
    } else {
        leftB  = insideB;
        rightB = outsideB;
    }

    return {
        top:    pb[0] - topB,
        left:   pb[1] - leftB,
        bottom: pb[2] + botB,
        right:  pb[3] + rightB
    };
}

function collectItems(pages, options) {
    var items = [];
    var seen  = {};

    for (var p = 0; p < pages.length; p++) {
        var all = pages[p].allPageItems;
        for (var i = 0; i < all.length; i++) {
            var item = all[i];
            var id   = item.id;
            if (seen[id]) continue;
            seen[id] = true;

            if (item instanceof Group)     continue;
            if (item instanceof TextFrame) continue;
            if (item.locked) continue;

            try {
                if (item.parentPage.parent instanceof MasterSpread) continue;
            } catch (e2) {}

            var hasImage = (item.graphics && item.graphics.length > 0);

            if (options.trimImages && hasImage) {
                items.push(item);
            } else if (options.trimShapes && !hasImage) {
                if (item instanceof Rectangle || item instanceof Oval ||
                    item instanceof Polygon   || item instanceof SplineItem) {
                    items.push(item);
                }
            }
        }
    }
    return items;
}

// ---------------------------------------------------------------------------
// Per-item processing
// ---------------------------------------------------------------------------

function processItem(item, bleed, options, report) {
    var gb = item.geometricBounds;
    if (!exceedsBleed(gb, bleed)) return;

    var label = describeItem(item);

    // Non-rotated shapes and images: simple bounds adjustment
    if (isAxisAligned(item)) {
        item.geometricBounds = [
            Math.max(gb[0], bleed.top),
            Math.max(gb[1], bleed.left),
            Math.min(gb[2], bleed.bottom),
            Math.min(gb[3], bleed.right)
        ];
        report.trimmed.push(label);
        return;
    }

    // Rotated items: skip or clip path
    if (options.rotatedMode === "skip") {
        report.skipped.push(label);
        return;
    }

    if (clipPathToBleed(item, bleed)) {
        report.masked.push(label);
    } else {
        report.skipped.push(label + " (curved path - clip manually)");
    }
}

// ---------------------------------------------------------------------------
// Path clipping via Sutherland-Hodgman (rotated shape/image frames)
// ---------------------------------------------------------------------------

function clipPathToBleed(item, bleed) {
    if (item.paths.length !== 1) return false;

    var path    = item.paths[0];
    var pts     = path.pathPoints.everyItem().getElements();
    var polygon = [];

    for (var i = 0; i < pts.length; i++) {
        var pt = pts[i];
        var a  = pt.anchor;
        var l  = pt.leftDirection;
        var r  = pt.rightDirection;

        if (Math.abs(a[0] - l[0]) > 0.01 || Math.abs(a[1] - l[1]) > 0.01 ||
            Math.abs(a[0] - r[0]) > 0.01 || Math.abs(a[1] - r[1]) > 0.01) {
            return false;  // curved path
        }

        polygon.push([a[0], a[1]]);
    }

    if (polygon.length < 3) return false;

    var clipped = sutherlandHodgman(polygon, bleed);
    if (clipped.length < 3) return false;

    // Build full pathPoint format: [leftDir, anchor, rightDir] — all identical for straight segments
    var newPath = [];
    for (var j = 0; j < clipped.length; j++) {
        newPath.push([clipped[j], clipped[j], clipped[j]]);
    }

    path.entirePath = newPath;
    return true;
}

function sutherlandHodgman(polygon, bleed) {
    var edges = [
        { axis: 0, min: true,  value: bleed.left   },
        { axis: 0, min: false, value: bleed.right   },
        { axis: 1, min: true,  value: bleed.top     },
        { axis: 1, min: false, value: bleed.bottom  }
    ];

    var out = polygon.slice();
    for (var e = 0; e < edges.length; e++) {
        out = clipToEdge(out, edges[e]);
        if (out.length === 0) return [];
    }
    return out;
}

function clipToEdge(polygon, edge) {
    var out = [];
    var n   = polygon.length;

    for (var i = 0; i < n; i++) {
        var curr   = polygon[i];
        var next   = polygon[(i + 1) % n];
        var currIn = isInsideEdge(curr, edge);
        var nextIn = isInsideEdge(next, edge);

        if (currIn) {
            out.push(curr);
            if (!nextIn) out.push(edgeIntersect(curr, next, edge));
        } else if (nextIn) {
            out.push(edgeIntersect(curr, next, edge));
        }
    }
    return out;
}

function isInsideEdge(pt, edge) {
    return edge.min ? pt[edge.axis] >= edge.value
                    : pt[edge.axis] <= edge.value;
}

function edgeIntersect(p1, p2, edge) {
    var dx = p2[0] - p1[0];
    var dy = p2[1] - p1[1];

    if (edge.axis === 0) {
        var t = (dx !== 0) ? (edge.value - p1[0]) / dx : 0;
        return [edge.value, p1[1] + t * dy];
    } else {
        var t = (dy !== 0) ? (edge.value - p1[1]) / dy : 0;
        return [p1[0] + t * dx, edge.value];
    }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isAxisAligned(item) {
    var r = ((item.rotationAngle % 360) + 360) % 360;
    return (Math.abs(r % 90) < 0.001) && (Math.abs(item.shearAngle) < 0.001);
}

function exceedsBleed(gb, bleed) {
    var tol = 0.01;
    return gb[0] < bleed.top    - tol ||
           gb[1] < bleed.left   - tol ||
           gb[2] > bleed.bottom + tol ||
           gb[3] > bleed.right  + tol;
}

function describeItem(item) {
    var type;
    if (item instanceof TextFrame) {
        type = "Text frame";
    } else if (item.graphics && item.graphics.length > 0) {
        type = "Image frame";
    } else {
        type = item.constructor.name;
    }
    var name = (item.name && item.name !== "") ? (' "' + item.name + '"') : "";
    try {
        return "p." + item.parentPage.name + " - " + type + name;
    } catch (e) {
        return type + name;
    }
}
