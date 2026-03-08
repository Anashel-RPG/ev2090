interface SparklineProps {
  data: number[];
  width?: number;
  height?: number;
  color?: string;
}

export function Sparkline({
  data,
  width = 100,
  height = 28,
  color = "var(--accent-blue)",
}: SparklineProps) {
  if (data.length < 2) {
    return (
      <svg width={width} height={height}>
        <line
          x1={0}
          y1={height / 2}
          x2={width}
          y2={height / 2}
          stroke="var(--border)"
          strokeWidth={1}
        />
      </svg>
    );
  }

  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const pad = 2;

  const points = data
    .map((v, i) => {
      const x = (i / (data.length - 1)) * width;
      const y = pad + ((max - v) / range) * (height - pad * 2);
      return `${x},${y}`;
    })
    .join(" ");

  // Trend color: compare first and last
  const trendColor =
    data[data.length - 1]! > data[0]!
      ? "var(--accent-green)"
      : data[data.length - 1]! < data[0]!
        ? "var(--accent-red)"
        : color;

  return (
    <svg width={width} height={height}>
      <polyline
        points={points}
        fill="none"
        stroke={trendColor}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
