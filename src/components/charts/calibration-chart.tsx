export function CalibrationChart({
  rows,
}: {
  rows: Array<{ band: string; predicted: number; observed: number }>
}) {
  return (
    <div
      className="calibration-chart"
      role="img"
      aria-label="Predicted confidence compared with observed outcomes"
    >
      {rows.map((row) => (
        <div className="calibration-chart__row" key={row.band}>
          <span>{row.band}</span>
          <div className="calibration-chart__bars">
            <span
              className="calibration-chart__bar calibration-chart__bar--predicted"
              style={{ width: `${row.predicted}%` }}
            />
            <span
              className="calibration-chart__bar calibration-chart__bar--observed"
              style={{ width: `${row.observed}%` }}
            />
          </div>
          <strong>{row.observed}%</strong>
        </div>
      ))}
      <div className="chart__legend" aria-hidden="true">
        <span>
          <i className="chart__key chart__key--benchmark" />
          Predicted
        </span>
        <span>
          <i className="chart__key chart__key--nav" />
          Observed
        </span>
      </div>
    </div>
  )
}
