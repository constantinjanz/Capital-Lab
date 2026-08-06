import type { EquityPoint } from '@/lib/mock/types'

function toPolyline(
  values: number[],
  width: number,
  height: number,
  min: number,
  max: number,
) {
  const range = max - min || 1
  return values
    .map((value, index) => {
      const x = (index / Math.max(values.length - 1, 1)) * width
      const y = height - ((value - min) / range) * height
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')
}

export function EquityChart({ points }: { points: EquityPoint[] }) {
  const values = points.flatMap((point) => [
    point.navMinor,
    point.benchmarkMinor,
  ])
  const min = Math.min(...values) - 80000
  const max = Math.max(...values) + 80000
  const navLine = toPolyline(
    points.map((point) => point.navMinor),
    800,
    220,
    min,
    max,
  )
  const benchmarkLine = toPolyline(
    points.map((point) => point.benchmarkMinor),
    800,
    220,
    min,
    max,
  )

  return (
    <div className="chart">
      <svg
        className="chart__canvas"
        viewBox="0 0 800 250"
        role="img"
        aria-labelledby="equity-chart-title equity-chart-description"
      >
        <title id="equity-chart-title">
          Equity curve compared with benchmark
        </title>
        <desc id="equity-chart-description">
          Net asset value rose from €100,000 to €103,842.66 while the benchmark
          rose to €102,110.
        </desc>
        {[0, 55, 110, 165, 220].map((y) => (
          <line key={y} x1="0" x2="800" y1={y} y2={y} className="chart__grid" />
        ))}
        <polyline
          points={benchmarkLine}
          className="chart__line chart__line--benchmark"
        />
        <polyline points={navLine} className="chart__line chart__line--nav" />
        {points.map((point, index) =>
          index % 3 === 0 || index === points.length - 1 ? (
            <text
              key={point.at}
              x={(index / Math.max(points.length - 1, 1)) * 800}
              y="245"
              textAnchor={
                index === 0
                  ? 'start'
                  : index === points.length - 1
                    ? 'end'
                    : 'middle'
              }
              className="chart__label"
            >
              {point.at}
            </text>
          ) : null,
        )}
      </svg>
      <div className="chart__legend" aria-hidden="true">
        <span>
          <i className="chart__key chart__key--nav" />
          Portfolio NAV
        </span>
        <span>
          <i className="chart__key chart__key--benchmark" />
          SPY benchmark
        </span>
      </div>
    </div>
  )
}
