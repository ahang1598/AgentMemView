import { EmptyState } from "../components/empty-state.js";

interface ReportRow {
  dataset: string;
  recallAt5: number;
  recallAt10: number;
  mrr: number;
  ranAt: string;
}

export default function EvalPage({ reports = [] }: { reports?: ReportRow[] }) {
  return (
    <div>
      <h2 className="page-title">评测中心</h2>
      {reports.length === 0 ? (
        <EmptyState
          title="还没有评测报告"
          guidance="导入 LongMemEval-S 或 LoCoMo 数据集后运行跑分。M5 阶段接通真实 harness；当前可先运行内置合成评测集（pnpm --filter @agentmemview/core test 会执行 R@5 基线）。"
        />
      ) : (
        <table className="table" data-testid="eval-table">
          <thead>
            <tr>
              <th>数据集</th>
              <th>R@5</th>
              <th>R@10</th>
              <th>MRR</th>
              <th>时间</th>
            </tr>
          </thead>
          <tbody>
            {reports.map((report) => (
              <tr key={`${report.dataset}-${report.ranAt}`}>
                <td>{report.dataset}</td>
                <td>{Math.round(report.recallAt5 * 100)}%</td>
                <td>{Math.round(report.recallAt10 * 100)}%</td>
                <td>{report.mrr.toFixed(3)}</td>
                <td className="muted">{report.ranAt}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
