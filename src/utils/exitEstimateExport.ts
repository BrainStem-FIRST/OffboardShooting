export interface ExitEstimateRow {
  name: string;
  speed: number | null;
  angle: number | null;
}

function padRight(s: string, width: number): string {
  return s.length >= width ? s : s + ' '.repeat(width - s.length);
}

function padLeft(s: string, width: number): string {
  return s.length >= width ? s : ' '.repeat(width - s.length) + s;
}

export function formatExitEstimatesTxt(
  videoName: string,
  framerate: number,
  numPointsForEstimate: number,
  rows: ExitEstimateRow[]
): string {
  const headers = ['trajectory', 'estimated_velocity_m_s', 'estimated_exit_angle_deg'];
  const speedStrs = rows.map((r) => (r.speed !== null ? r.speed.toFixed(4) : ''));
  const angleStrs = rows.map((r) => (r.angle !== null ? r.angle.toFixed(4) : ''));
  const nameStrs = rows.map((r) => r.name);

  const colWidths = [
    Math.max(headers[0].length, ...nameStrs.map((s) => s.length), 0),
    Math.max(headers[1].length, ...speedStrs.map((s) => s.length), 0),
    Math.max(headers[2].length, ...angleStrs.map((s) => s.length), 0),
  ];

  const lines: string[] = [
    '# Exit velocity / angle estimates',
    `video: ${videoName}`,
    `framerate_fps: ${framerate}`,
    `num_points_for_estimate: ${numPointsForEstimate}`,
    '',
    [
      padRight(headers[0], colWidths[0]),
      padLeft(headers[1], colWidths[1]),
      padLeft(headers[2], colWidths[2]),
    ].join('  '),
  ];

  for (let i = 0; i < rows.length; i++) {
    lines.push(
      [
        padRight(nameStrs[i], colWidths[0]),
        padLeft(speedStrs[i], colWidths[1]),
        padLeft(angleStrs[i], colWidths[2]),
      ].join('  ')
    );
  }

  return lines.join('\n');
}

export function downloadExitEstimatesTxt(
  videoName: string,
  framerate: number,
  numPointsForEstimate: number,
  rows: ExitEstimateRow[]
): void {
  const text = formatExitEstimatesTxt(videoName, framerate, numPointsForEstimate, rows);
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const stem = videoName.replace(/\.[^.]+$/, '');
  const a = document.createElement('a');
  a.href = url;
  a.download = `${stem}_exit_estimates.txt`;
  a.click();
  URL.revokeObjectURL(url);
}
