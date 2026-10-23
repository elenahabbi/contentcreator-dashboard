// chart-fallback.js
//
// Loaded directly after the existing cdnjs <script> tag for Chart.js 4.4.4 in
// dashboard.html and analytics.html. It does nothing when cdnjs worked.
//
// If cdnjs did not deliver Chart.js (blocked by the network or a browser
// extension, offline, or a bad URL), it tries, in order:
//   1. the same version from jsDelivr, then
//   2. vendor/chart.umd.js next to the HTML files.
// Option 2 only works if you add that file yourself; it is NOT shipped with
// the project. Save https://cdn.jsdelivr.net/npm/chart.js@4.4.4/dist/chart.umd.js
// as frontend/vendor/chart.umd.js if you want an offline copy.
//
// document.write is used on purpose: the fallback script must finish loading
// before analytics.js / dashboard.js run, and parser-blocking writes keep that
// order without changing how those files start up. The console says which
// source was used, or that none worked.

(function () {
    if (typeof window.Chart !== "undefined") {
        console.info("[charts] Chart.js loaded from cdnjs.");
        return;
    }

    console.warn("[charts] Chart.js did not load from cdnjs; trying fallbacks.");

    var remote = "https://cdn.jsdelivr.net/npm/chart.js@4.4.4/dist/chart.umd.js";
    var local = "vendor/chart.umd.js";
    var close = "<" + "/script>";

    document.write(
        '<script src="' + remote + '">' + close +
        '<script>if (typeof Chart === "undefined") { console.warn("[charts] jsDelivr copy did not load; trying vendor/chart.umd.js."); document.write(\'<script src="' + local + '">\' + "<" + "/script>"); } else { console.info("[charts] Chart.js loaded from jsDelivr fallback."); }' + close +
        '<script>if (typeof Chart === "undefined") { console.error("[charts] Chart.js could not be loaded from cdnjs, jsDelivr or vendor/chart.umd.js. Graphs will show an explanatory message."); }' + close
    );
})();