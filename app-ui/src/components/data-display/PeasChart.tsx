import { useEffect, useRef, useState } from "react";
import { Chart, registerables, type ChartConfiguration, type ChartType } from "chart.js";

Chart.register(...registerables);

export interface PeasChartDataset {
  label: string;
  data: number[];
  backgroundColor: string;
  borderColor?: string;
}

interface PeasChartProps {
  type: ChartType;
  labels: string[];
  datasets: PeasChartDataset[];
  ariaLabel: string;
  tableHeaders: string[];
  tableRows: Array<Array<string | number>>;
  emptyTitle: string;
  emptyDescription: string;
}

export function PeasChart({ type, labels, datasets, ariaLabel, tableHeaders, tableRows, emptyTitle, emptyDescription }: PeasChartProps) {
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const [reduceMotion, setReduceMotion] = useState(() => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  const hasData = datasets.some((dataset) => dataset.data.some((value) => value > 0));

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduceMotion(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    if (!canvas.current || !hasData) return;
    const configuration: ChartConfiguration = {
      type,
      data: { labels, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: reduceMotion ? false : { duration: 250 },
        plugins: { legend: { display: true }, tooltip: { enabled: true } },
        scales: { y: { beginAtZero: true, ticks: { precision: 0 } } },
      },
    };
    const chart = new Chart(canvas.current, configuration);
    return () => chart.destroy();
  }, [datasets, hasData, labels, reduceMotion, type]);

  if (!hasData) return <div className="peas-chart-empty"><strong>{emptyTitle}</strong><span>{emptyDescription}</span></div>;
  return <div className="peas-chart-wrap">
    <div className="peas-chart-canvas" role="img" aria-label={ariaLabel}><canvas ref={canvas} aria-hidden="true" /></div>
    <details className="peas-report-data"><summary>View data table</summary><table><thead><tr>{tableHeaders.map((header) => <th key={header}>{header}</th>)}</tr></thead><tbody>{tableRows.map((row, index) => <tr key={`${labels[index] ?? index}`}>{row.map((value, cellIndex) => <td key={`${index}-${cellIndex}`}>{value}</td>)}</tr>)}</tbody></table></details>
  </div>;
}
