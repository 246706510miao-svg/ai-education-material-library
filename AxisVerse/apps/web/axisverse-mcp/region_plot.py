"""Plot intersections of bounded arithmetic inequalities without executing model code."""
from __future__ import annotations

import ast
from dataclasses import dataclass
import hashlib
import io
import json
import math
import os
from pathlib import Path
import tempfile
import threading

import numpy as np
from matplotlib.figure import Figure
from matplotlib.backends.backend_agg import FigureCanvasAgg
from matplotlib.ticker import FuncFormatter, StrMethodFormatter
from matplotlib.transforms import ScaledTranslation

RENDER_LOCK = threading.Lock()


class PlotInputError(ValueError):
    """An unsupported mathematical condition or invalid plotting window."""


def expression(node: ast.AST, x: np.ndarray, y: np.ndarray):
    """Evaluate only a small arithmetic grammar on NumPy arrays; never eval Python."""
    if isinstance(node, ast.Constant) and type(node.value) in (int, float):
        if not math.isfinite(node.value) or abs(node.value) > 1_000_000:
            raise PlotInputError('常数必须有限且绝对值不超过 1000000。')
        return float(node.value)
    if isinstance(node, ast.Name) and node.id in ('x', 'y', 'pi'):
        return {'x': x, 'y': y, 'pi': np.pi}[node.id]
    if isinstance(node, ast.UnaryOp) and isinstance(node.op, (ast.UAdd, ast.USub)):
        value = expression(node.operand, x, y)
        return -value if isinstance(node.op, ast.USub) else value
    if isinstance(node, ast.BinOp):
        if isinstance(node.op, ast.Pow):
            if not isinstance(node.right, ast.Constant) or type(node.right.value) is not int or not 0 <= node.right.value <= 8:
                raise PlotInputError('幂指数目前只支持 0—8 的整数。')
            return expression(node.left, x, y) ** node.right.value
        a, b = expression(node.left, x, y), expression(node.right, x, y)
        if isinstance(node.op, ast.Add): return a + b
        if isinstance(node.op, ast.Sub): return a - b
        if isinstance(node.op, ast.Mult): return a * b
        if isinstance(node.op, ast.Div) and np.ndim(b) == 0 and b != 0: return a / b
    if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id in ('sqrt', 'abs') and len(node.args) == 1 and not node.keywords:
        return {'sqrt': np.sqrt, 'abs': np.abs}[node.func.id](expression(node.args[0], x, y))
    raise PlotInputError('只支持 x、y、pi、加减乘、除以非零常数、0—8 次整数幂、sqrt 和 abs；不执行代码。')


@dataclass(frozen=True)
class Condition:
    """One inequality whose signed value is negative inside its half-region."""
    text: str
    tree: ast.Compare
    strict: bool

    @classmethod
    def parse(cls, text: str) -> Condition:
        if not 1 <= len(text) <= 160:
            raise PlotInputError('每个不等式长度必须为 1—160 字符。')
        normalized = text.strip().replace('≤', '<=').replace('≥', '>=').replace('²', '**2').replace('³', '**3').replace('^', '**')
        try:
            node = ast.parse(normalized, mode='eval').body
        except (SyntaxError, RecursionError) as error:
            raise PlotInputError('不等式无法解析，例如 x**2 + y**2 <= 4；每条只写一个比较。') from error
        if len(list(ast.walk(node))) > 70 or not isinstance(node, ast.Compare) or len(node.ops) != 1 or not isinstance(node.ops[0], (ast.Lt, ast.LtE, ast.Gt, ast.GtE)):
            raise PlotInputError('请拆成最多 8 个简单不等式，不使用等式、连写比较、且/或。')
        result = cls(normalized, node, isinstance(node.ops[0], (ast.Lt, ast.Gt)))
        result.values(np.array([.3]), np.array([.4]))
        return result

    def values(self, x: np.ndarray, y: np.ndarray) -> np.ndarray:
        with np.errstate(all='ignore'):
            lhs = expression(self.tree.left, x, y)
            rhs = expression(self.tree.comparators[0], x, y)
            value = lhs - rhs if isinstance(self.tree.ops[0], (ast.Lt, ast.LtE)) else rhs - lhs
            return np.broadcast_to(value, np.broadcast_shapes(x.shape, y.shape)).astype(float)

    def contains(self, x: np.ndarray, y: np.ndarray) -> np.ndarray:
        value = self.values(x, y)
        return np.isfinite(value) & (value < 0 if self.strict else value <= 0)


def sample_region(inequalities: list[str], bounds: tuple[float, float, float, float], resolution: int):
    """Return the finite intersection on a grid; window edges are not new constraints."""
    if not 1 <= len(inequalities) <= 8:
        raise PlotInputError('请提供 1—8 个共同满足的不等式。')
    if any(not math.isfinite(v) or abs(v) > 1_000_000 for v in bounds):
        raise PlotInputError('坐标范围必须有限且绝对值不超过 1000000。')
    xmin, xmax, ymin, ymax = bounds
    if not 1e-7 <= xmax - xmin <= 1_000_000 or not 1e-7 <= ymax - ymin <= 1_000_000:
        raise PlotInputError('坐标上下限须递增，跨度为 0.0000001—1000000。')
    conditions = [Condition.parse(text) for text in inequalities]
    x, y = np.meshgrid(np.linspace(xmin, xmax, resolution), np.linspace(ymin, ymax, resolution))
    fields = [condition.values(x, y) for condition in conditions]
    mask = np.logical_and.reduce([np.isfinite(value) & (value < 0 if condition.strict else value <= 0) for condition, value in zip(conditions, fields)])
    return conditions, x, y, fields, mask


def readable(text: str) -> str:
    """Format supported comparison and polynomial notation for plot labels."""
    text = text.replace(' ** ', '**')
    for power, symbol in [(2, '²'), (3, '³'), (4, '⁴'), (5, '⁵'), (6, '⁶'), (7, '⁷'), (8, '⁸')]:
        text = text.replace(f'**{power}', symbol)
    return text.replace('<=', '≤').replace('>=', '≥').replace('*', '·')


def publish_png(data: bytes, filename: str, directories: tuple[Path, ...]) -> None:
    """Atomically publish immutable images in each configured static-asset directory."""
    for directory in directories:
        directory.mkdir(parents=True, exist_ok=True)
        with tempfile.NamedTemporaryFile(dir=directory, prefix='.region-', suffix='.tmp', delete=False) as temporary:
            temp = Path(temporary.name)
            temporary.write(data)
        try:
            os.replace(temp, directory / filename)
        finally:
            temp.unlink(missing_ok=True)


def affine(node: ast.AST) -> np.ndarray | None:
    """Return exact arithmetic coefficients of a*x+b*y+c, or None for nonlinear syntax."""
    if isinstance(node, ast.Name) and node.id in ('x', 'y'):
        return np.array([float(node.id == 'x'), float(node.id == 'y'), 0.])
    if not any(isinstance(item, ast.Name) and item.id in ('x', 'y') for item in ast.walk(node)):
        value = float(expression(node, np.array(0.), np.array(0.)))
        return np.array([0., 0., value]) if math.isfinite(value) else None
    if isinstance(node, ast.UnaryOp):
        value = affine(node.operand)
        return None if value is None else -value if isinstance(node.op, ast.USub) else value
    if isinstance(node, ast.BinOp):
        left, right = affine(node.left), affine(node.right)
        if left is None or right is None:
            return None
        if isinstance(node.op, ast.Add): return left + right
        if isinstance(node.op, ast.Sub): return left - right
        if isinstance(node.op, ast.Mult):
            if np.all(left[:2] == 0): return left[2] * right
            if np.all(right[:2] == 0): return right[2] * left
        if isinstance(node.op, ast.Div) and np.all(right[:2] == 0) and right[2] != 0:
            return left / right[2]
    return None


def coordinate_limit(condition: Condition) -> tuple[int, float] | None:
    """Identify a single affine x or y limit without changing its inclusion predicate."""
    left, right = affine(condition.tree.left), affine(condition.tree.comparators[0])
    if left is None or right is None:
        return None
    coefficients = left - right
    axes = np.flatnonzero(coefficients[:2])
    if len(axes) != 1:
        return None
    axis = int(axes[0])
    return axis, float(-coefficients[2] / coefficients[axis])


def limit_extent(conditions: list[Condition], axis: int, position: float, bounds: tuple[float, float, float, float], resolution: int) -> tuple[float, float] | None:
    """Sample the closure on a coordinate limit, adding bracketed roots to retain point intersections."""
    other_axis = 1 - axis
    samples = np.linspace(bounds[2 * other_axis], bounds[2 * other_axis + 1], resolution)
    def values(condition: Condition, points: np.ndarray) -> np.ndarray:
        fixed = np.full_like(points, position)
        return condition.values(fixed, points) if axis == 0 else condition.values(points, fixed)
    roots = []
    for condition in conditions:
        field = values(condition, samples)
        crossings = np.flatnonzero(np.isfinite(field[:-1]) & np.isfinite(field[1:]) & (np.signbit(field[:-1]) != np.signbit(field[1:])))
        if len(crossings):
            low, high = samples[crossings].copy(), samples[crossings + 1].copy()
            low_sign = np.signbit(field[crossings])
            for _ in range(45):
                middle = (low + high) / 2
                same_side = np.signbit(values(condition, middle)) == low_sign
                low = np.where(same_side, middle, low)
                high = np.where(same_side, high, middle)
            roots.extend((low + high) / 2)
    candidates = np.unique(np.concatenate((samples, roots)))
    included = np.ones(len(candidates), dtype=bool)
    for condition in conditions:
        field = values(condition, candidates)
        included &= np.isfinite(field) & (field <= 1e-9)
    kept = candidates[included]
    return (float(kept.min()), float(kept.max())) if len(kept) else None


def plot_region(inequalities: list[str], bounds: tuple[float, float, float, float], directories: tuple[Path, ...], asset_base_url: str, resolution: int, font_path: Path | None, integration_guides: tuple[tuple[float, float], ...] = ()) -> dict[str, object]:
    """Render a numeric intersection with its exact input conditions and clipping warning."""
    conditions, x, y, fields, mask = sample_region(inequalities, bounds, resolution)
    if len(integration_guides) > 8:
        raise PlotInputError('积分限辅助点最多 8 个。')
    if integration_guides and not bounds[2] <= 0 <= bounds[3]:
        raise PlotInputError('积分限投影需要在显示窗口中包含 x 轴（y=0）。')
    for px, py in integration_guides:
        if not math.isfinite(px) or not math.isfinite(py) or not bounds[0] <= px <= bounds[1] or not bounds[2] <= py <= bounds[3]:
            raise PlotInputError('积分限辅助点必须有限且位于显示窗口内。')
    cells = mask[:-1, :-1] & mask[1:, :-1] & mask[:-1, 1:] & mask[1:, 1:]
    common = {'conditions': [c.text for c in conditions], 'window': dict(zip(('x_min', 'x_max', 'y_min', 'y_max'), bounds)), 'source': 'generated_from_user_conditions', 'method': 'numeric_grid_intersection', 'grid_size': resolution, 'is_exact_symbolic_solution': False, 'integration_guides': [{'x': px, 'y': py, 'to_y': 0} for px, py in integration_guides]}
    if not np.any(cells):
        return {**common, 'status': 'no_visible_region', 'notice': '当前窗口与采样精度下没有找到有面积的区域；可能无交集、区域太窄或不在窗口内。不能据此断言原题无解。'}
    clipped = bool(np.any(mask[0]) or np.any(mask[-1]) or np.any(mask[:, 0]) or np.any(mask[:, -1]))
    undefined = int(np.count_nonzero(~np.logical_and.reduce([np.isfinite(v) for v in fields])))
    limits = [coordinate_limit(condition) for condition in conditions]
    projections = {}
    for limit in limits:
        if limit is None:
            continue
        axis, position = limit
        if position == 0 or not bounds[2 * axis] <= position <= bounds[2 * axis + 1]:
            continue
        extent = limit_extent(conditions, axis, position, bounds, resolution)
        if extent is not None:
            projections[limit] = (min(0., extent[0]), max(0., extent[1]))
    for px, py in integration_guides:
        if px != 0:
            low, high = projections.get((0, px), (0., 0.))
            projections[(0, px)] = (min(low, py), max(high, py))
    key = json.dumps({'renderer': 7, 'conditions': common['conditions'], 'bounds': bounds, 'resolution': resolution, 'integration_guides': integration_guides}, sort_keys=True)
    filename = 'region-' + hashlib.sha256(key.encode()).hexdigest()[:24] + '.png'
    url = asset_base_url.rstrip('/') + '/' + filename
    with RENDER_LOCK:
        fig = Figure(figsize=(8, 8), dpi=160, facecolor='#FFFFFF')
        FigureCanvasAgg(fig)
        ax = fig.add_axes([.09, .09, .83, .83])
        ax.set(xlim=bounds[:2], ylim=bounds[2:], xlabel='x', ylabel='y', aspect='equal')
        ax.contourf(x, y, mask.astype(float), levels=[.5, 1.5], colors=['#93C5FD'], alpha=.35)
        boundaries = []
        for condition, value, limit in zip(conditions, fields, limits):
            if limit is not None:
                continue
            finite = value[np.isfinite(value)]
            style = '--' if condition.strict else '-'
            if finite.size and float(np.min(finite)) < 0 < float(np.max(finite)):
                contour = ax.contour(x, y, np.ma.masked_invalid(value), levels=[0], colors=['#6B7280' if condition.strict else '#2563EB'], linewidths=2.2, linestyles=style)
                label = readable(ast.unparse(condition.tree.left)) + ' = ' + readable(ast.unparse(condition.tree.comparators[0]))
                segments = [s for s in contour.allsegs[0] if len(s)]
                if segments:
                    boundaries.append((contour, label, np.concatenate(segments)))
        origin = np.array([bounds[0], bounds[2]])
        span = np.array([bounds[1] - bounds[0], bounds[3] - bounds[2]])
        for index, (contour, label, vertices) in enumerate(boundaries):
            normalized = (vertices - origin) / span
            interior = normalized[np.all((normalized > .14) & (normalized < .86), axis=1)]
            candidates = interior[::max(1, len(interior) // 80)]
            if len(candidates):
                # Keep labels away from other curves, frame edges, and coordinate axes.
                clearance = np.min(np.minimum(candidates, 1 - candidates), axis=1)
                for other_index, (_, _, other) in enumerate(boundaries):
                    if index != other_index:
                        distance = np.linalg.norm(candidates[:, None, :] - ((other - origin) / span)[None, ::4, :], axis=2).min(axis=1)
                        clearance = np.minimum(clearance, distance)
                for axis in range(2):
                    if bounds[axis * 2] < 0 < bounds[axis * 2 + 1]:
                        clearance = np.minimum(clearance, np.abs(candidates[:, axis] + origin[axis] / span[axis]))
                anchor = candidates[np.argmax(clearance)] * span + origin
                labels = ax.clabel(contour, levels=[0], fmt={0: label}, manual=[tuple(anchor)], inline=True, inline_spacing=8, fontsize=11, colors=['#374151'])
                for text in labels:
                    text.set_clip_on(False)
            else:
                ax.clabel(contour, levels=[0], fmt={0: label}, inline=True, fontsize=9, colors=['#374151'])
        for (axis, position), (low, high) in projections.items():
            horizontal, vertical = ([position, position], [low, high]) if axis == 0 else ([low, high], [position, position])
            ax.plot(horizontal, vertical, color='#6B7280', lw=1.2, linestyle=(0, (5, 4)), zorder=3)
        for px, py in set(integration_guides):
            ax.scatter([px], [py], color='#DC2626', s=18, zorder=4)
        ax.xaxis.label.set_color('#000000');ax.yaxis.label.set_color('#000000')
        ax.tick_params(labelsize=10, colors='#000000', length=3)
        ax.grid(color='#E5E7EB', linewidth=.6, alpha=.55)
        ax.set_axisbelow(True)
        for spine in ax.spines.values():
            spine.set_color('#E5E7EB');spine.set_linewidth(.7)
        for name, lower, upper in [('bottom', bounds[2], bounds[3]), ('left', bounds[0], bounds[1])]:
            if lower <= 0 <= upper:
                ax.spines[name].set_position(('data', 0))
            ax.spines[name].set_color('#000000');ax.spines[name].set_linewidth(1)
        for axis, axis_object, set_ticks in [(0, ax.xaxis, ax.set_xticks), (1, ax.yaxis, ax.set_yticks)]:
            positions = [position for direction, position in projections if direction == axis]
            if bounds[2 * axis] <= 0 <= bounds[2 * axis + 1]:
                positions.append(0.)
            ticks = [tick for tick in axis_object.get_majorticklocs() if bounds[2 * axis] <= tick <= bounds[2 * axis + 1] and all(abs(tick - position) > span[axis] * .055 for position in positions)]
            set_ticks(sorted(set(ticks + positions)))
            axis_object.set_major_formatter(StrMethodFormatter('{x:g}'))
        ax.xaxis.set_label_coords(1.025, np.clip(-bounds[2] / span[1], 0, 1))
        ax.yaxis.set_label_coords(np.clip(-bounds[0] / span[0], 0, 1), 1.025)
        ax.yaxis.label.set_rotation(0)
        if bounds[0] <= 0 <= bounds[1] and bounds[2] <= 0 <= bounds[3]:
            ax.yaxis.set_major_formatter(FuncFormatter(lambda value, _: '' if value == 0 else f'{value:g}'))
            for tick, label in zip(ax.get_xticks(), ax.get_xticklabels()):
                if tick == 0:
                    label.set_horizontalalignment('right')
                    label.set_transform(label.get_transform() + ScaledTranslation(-5 / 72, 0, fig.dpi_scale_trans))
        notice = '区域碰到窗口边缘：图可能未展示完整区域。' if clipped else '边界按数值采样绘制；图用于理解，不代替解析推导。'
        buffer = io.BytesIO();fig.savefig(buffer, format='png', dpi=160);data = buffer.getvalue()
        publish_png(data, filename, directories)
    return {**common, 'status': 'plotted', 'touches_plot_edge': clipped, 'undefined_grid_points': undefined, 'notice': notice, 'url': url, 'markdown': f'[![积分区域]({url})]({url})'}
