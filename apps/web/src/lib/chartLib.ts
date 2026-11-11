// Chart.js is shipped inside the app and handed to dashboards as the global `Chart`, because a dashboard's frame can't
// load anything from the internet. Imported by path (the package doesn't export its browser build) as plain text.
import chartLib from "../../node_modules/chart.js/dist/chart.umd.min.js?raw";

export const CHART_LIBRARY: string = chartLib;
