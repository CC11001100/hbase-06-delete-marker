/**
 * 删除标记与墓碑 — 步骤生成器
 *
 * 动画展示 HBase 删除不是物理删除，而是写入墓碑标记 (tombstone)：
 * DeleteFamily / DeleteColumn / DeleteVersion 三种墓碑覆盖不同范围，
 * 只有 major compaction 才真正物理删除被墓碑覆盖的数据。
 */
import type { Step, VisualElement, VariableState } from '../types'

/** 删除标记伪代码 */
export const TEMPLATE_CODE = `// HBase 删除：写入墓碑而非物理删除
Delete del = new Delete(Bytes.toBytes("row1"));

// 1. DeleteVersion：仅删除指定 ts 的单个版本
del.addColumn(cf, qual, 3L);     // 只删 ts=3 的版本

// 2. DeleteColumn：删除 ts <= 指定值的所有版本
del.addColumns(cf, qual, 5L);    // 删除 ts<=5 的全部版本

// 3. DeleteFamily：删除整行的某列族所有版本
del.addFamily(cf);               // 删除 info 列族全部数据

table.delete(del);

// 4. 墓碑写入后，被覆盖的版本对读不可见，但物理数据仍在
// 只有 major compaction 才真正物理删除
HColumnDescriptor cd = new HColumnDescriptor(cf);
cd.setMaxVersions(3);`

// 画布布局常量
const LAYOUT = {
  cell: { x: 300, y: 50, w: 380, h: 400, label: 'Cell (row1, info:name)' },
}

/** 版本数据：ts 降序 */
const VERSIONS = [
  { ts: 6, value: 'F' },
  { ts: 5, value: 'E' },
  { ts: 4, value: 'D' },
  { ts: 3, value: 'C' },
]

/** 墓碑位置：插入到版本列表，标记覆盖范围 */
function buildVersionElements(
  states: Record<number, string>,
  tombstone?: { ts: number; type: string; afterIdx: number }
): VisualElement[] {
  const cellBox: VisualElement = {
    id: 'cell',
    type: 'cell',
    label: LAYOUT.cell.label,
    x: LAYOUT.cell.x,
    y: LAYOUT.cell.y,
    width: LAYOUT.cell.w,
    height: LAYOUT.cell.h,
    state: 'idle',
  }
  const els: VisualElement[] = [cellBox]
  let row = 0
  VERSIONS.forEach((v, i) => {
    // 墓碑插入在指定版本之前
    if (tombstone && tombstone.afterIdx === i) {
      els.push({
        id: `tomb-${tombstone.type}`,
        type: 'tombstone',
        label: `${tombstone.type}`,
        subLabel: `tombstone ts=${tombstone.ts}`,
        x: LAYOUT.cell.x + 20,
        y: LAYOUT.cell.y + 30 + row * 80,
        width: 340,
        height: 60,
        state: 'deleted',
      })
      row++
    }
    els.push({
      id: `ver-${v.ts}`,
      type: 'version',
      label: `v=${v.value}`,
      subLabel: `ts=${v.ts}`,
      x: LAYOUT.cell.x + 30,
      y: LAYOUT.cell.y + 30 + row * 80,
      width: 320,
      height: 70,
      state: states[v.ts] ?? 'idle',
    })
    row++
  })
  return els
}

export function generateSteps(): Step[] {
  const steps: Step[] = []
  let idx = 0

  const push = (
    desc: string,
    line: number,
    vars: VariableState[],
    elements: VisualElement[],
    arrows: { from: string; to: string; label?: string }[] = [],
    actionLabel?: string,
    statusText?: string
  ) => {
    steps.push({
      index: idx++,
      description: desc,
      currentLine: line,
      variables: vars,
      elements,
      connections: arrows.map((a, i) => ({
        id: `arrow-${i}`,
        fromId: a.from,
        toId: a.to,
        kind: 'arrow' as const,
        label: a.label,
      })),
      annotations: [],
      actionLabel,
      statusText: statusText ?? desc,
    })
  }

  const idleStates = { 6: 'idle', 5: 'idle', 4: 'idle', 3: 'idle' }

  // 步骤 0：删除机制总览
  push(
    'HBase 删除不立即物理删除：写入墓碑标记 (tombstone)，被覆盖版本对读不可见',
    0,
    [
      { name: 'row', value: 'row1', line: 2, type: 'byte[]' },
      { name: '物理删除', value: 'false', line: 0 },
    ],
    buildVersionElements(idleStates),
    [],
    'OVERVIEW',
    '删除机制总览'
  )

  // 步骤 1：现有版本快照
  push(
    'Cell 当前有 4 个版本：F(6),E(5),D(4),C(3)，按 ts 降序排列',
    2,
    [
      { name: 'row', value: 'row1', line: 2 },
      { name: 'versions', value: '4', line: 2 },
    ],
    buildVersionElements({ 6: 'active', 5: 'active', 4: 'active', 3: 'active' }),
    [{ from: 'cell', to: 'ver-6', label: '最新' }],
    'SNAPSHOT',
    '版本快照'
  )

  // 步骤 2：DeleteVersion（addColumn 单版本）
  push(
    'del.addColumn(cf, qual, 3L) = DeleteVersion：仅给 ts=3 的版本加墓碑，只删单个版本',
    4,
    [
      { name: 'tombstoneType', value: 'DeleteVersion', line: 4 },
      { name: 'covered', value: 'ts==3', line: 4 },
      { name: '物理删除', value: 'false', line: 4 },
    ],
    buildVersionElements(
      { 6: 'idle', 5: 'idle', 4: 'idle', 3: 'deleted' },
      { ts: 3, type: 'DeleteVersion', afterIdx: 3 }
    ),
    [{ from: 'cell', to: 'ver-3', label: '墓碑覆盖' }],
    'DELETE_VERSION',
    'DeleteVersion'
  )

  // 步骤 3：DeleteColumn（addColumns 多版本）
  push(
    'del.addColumns(cf, qual, 5L) = DeleteColumn：给 ts<=5 的所有版本加墓碑（E、D、C）',
    7,
    [
      { name: 'tombstoneType', value: 'DeleteColumn', line: 7 },
      { name: 'covered', value: 'ts<=5', line: 7 },
      { name: '物理删除', value: 'false', line: 7 },
    ],
    buildVersionElements(
      { 6: 'idle', 5: 'deleted', 4: 'deleted', 3: 'deleted' },
      { ts: 5, type: 'DeleteColumn', afterIdx: 1 }
    ),
    [
      { from: 'cell', to: 'ver-5', label: 'ts<=5 覆盖' },
      { from: 'ver-5', to: 'ver-3', label: '向下覆盖' },
    ],
    'DELETE_COLUMN',
    'DeleteColumn'
  )

  // 步骤 4：DeleteFamily（addFamily 整列族）
  push(
    'del.addFamily(cf) = DeleteFamily：给整行 info 列族的所有版本加墓碑，全量覆盖',
    10,
    [
      { name: 'tombstoneType', value: 'DeleteFamily', line: 10 },
      { name: 'covered', value: 'cf=all', line: 10 },
      { name: '物理删除', value: 'false', line: 10 },
    ],
    buildVersionElements(
      { 6: 'deleted', 5: 'deleted', 4: 'deleted', 3: 'deleted' },
      { ts: 6, type: 'DeleteFamily', afterIdx: 0 }
    ),
    [
      { from: 'cell', to: 'ver-6', label: '整列族' },
      { from: 'ver-6', to: 'ver-3', label: '全部覆盖' },
    ],
    'DELETE_FAMILY',
    'DeleteFamily'
  )

  // 步骤 5：读取过滤
  push(
    '墓碑写入后读取：被覆盖版本对 Scan/Get 不可见，但底层物理数据仍在 HFile 中',
    13,
    [
      { name: '可见', value: '无（全墓碑）', line: 13 },
      { name: '物理数据', value: '仍在 HFile', line: 13 },
    ],
    buildVersionElements(
      { 6: 'deleted', 5: 'deleted', 4: 'deleted', 3: 'deleted' },
      { ts: 6, type: 'DeleteFamily', afterIdx: 0 }
    ),
    [],
    'READ',
    '读取过滤'
  )

  // 步骤 6：minor compaction 不物理删
  push(
    'minor compaction 只合并小 HFile，不清理墓碑：墓碑与被删数据一起被保留',
    14,
    [
      { name: 'compaction', value: 'minor', line: 14 },
      { name: '墓碑清理', value: '否', line: 14 },
      { name: '物理删除', value: 'false', line: 14 },
    ],
    buildVersionElements(
      { 6: 'deleted', 5: 'deleted', 4: 'deleted', 3: 'deleted' },
      { ts: 6, type: 'DeleteFamily', afterIdx: 0 }
    ),
    [],
    'MINOR_COMPACTION',
    'minor compaction'
  )

  // 步骤 7：major compaction 物理删除
  push(
    'major compaction 才真正物理删除：丢弃被墓碑覆盖的版本与墓碑本身，释放空间',
    14,
    [
      { name: 'compaction', value: 'major', line: 14 },
      { name: '墓碑清理', value: '是', line: 14 },
      { name: '物理删除', value: 'true', line: 14 },
    ],
    buildVersionElements({ 6: 'deleted', 5: 'deleted', 4: 'deleted', 3: 'deleted' }).map((e) =>
      e.id.startsWith('ver-') || e.id === 'cell'
        ? e
        : { ...e, state: 'done' }
    ),
    [],
    'MAJOR_COMPACTION',
    'major compaction'
  )

  // 步骤 8：删除完成
  push(
    '删除完成：墓碑使版本逻辑不可见，major compaction 后物理消失；删除是"标记+延迟清理"',
    16,
    [
      { name: 'tombstoneType', value: 'DeleteFamily', line: 10 },
      { name: '物理删除', value: 'true (major)', line: 14 },
      { name: 'maxVersions', value: '3', line: 16 },
    ],
    [
      {
        id: 'cell',
        type: 'cell',
        label: LAYOUT.cell.label,
        x: LAYOUT.cell.x,
        y: LAYOUT.cell.y,
        width: LAYOUT.cell.w,
        height: LAYOUT.cell.h,
        state: 'done',
      },
    ],
    [],
    'DONE',
    '删除完成'
  )

  return steps
}
