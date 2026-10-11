"""Check geometric meaning, unsupported math, persisted assets, and MCP plotting."""
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import numpy as np
from matplotlib.figure import Figure
from mcp import Client
from test_server import ROOT
from server import Settings, build_server
from region_plot import Condition, PlotInputError, sample_region, plot_region, coordinate_limit

FONT = Path('C:/Windows/Fonts/msyh.ttc')


class RegionGeometryTests(unittest.TestCase):
    def test_circle_and_diagonal_keep_the_intended_half_disk(self):
        conditions, x, y, values, mask = sample_region(['x**2+y**2<=4', 'y>=x'], (-2.5,2.5,-2.5,2.5), 401)
        points_x=np.array([0.,0.,1.,-1.,2.1]);points_y=np.array([1.,-1.,0.,0.,0.])
        kept=conditions[0].contains(points_x,points_y)&conditions[1].contains(points_x,points_y)
        np.testing.assert_array_equal(kept,[True,False,False,True,False])
        numeric_area=mask.sum()*(5/400)**2
        self.assertAlmostEqual(numeric_area,2*np.pi,delta=.04)
        self.assertFalse(mask[0].any() or mask[-1].any() or mask[:,0].any() or mask[:,-1].any())

    def test_parabola_and_line_keep_between_curves(self):
        lower=Condition.parse('y >= x**2');upper=Condition.parse('y <= 2*x')
        x=np.array([1.,1.,1.,-1.,3.]);y=np.array([1.5,.5,2.5,0.,5.])
        np.testing.assert_array_equal(lower.contains(x,y)&upper.contains(x,y),[True,False,False,False,False])
        self.assertFalse(Condition.parse('x > 0').contains(np.array([0.]),np.array([1.]))[0])

    def test_only_supported_arithmetic_is_accepted(self):
        for text in ['__import__("os").system("echo x") < 1','x.__class__ == y','x[0] < y','x < y or y < 2','0 < x < 2','1/x < y','x**1000 < y','sin(x) < y']:
            with self.subTest(text=text),self.assertRaises(PlotInputError):Condition.parse(text)
        np.testing.assert_array_equal(Condition.parse('sqrt(x) + abs(y) <= 3').contains(np.array([4.,-1.]),np.array([-1.,0.])),[True,False])

    def test_empty_region_and_window_clipping_are_distinct(self):
        with tempfile.TemporaryDirectory() as directory:
            target=Path(directory);font=FONT if FONT.exists() else None
            empty=plot_region(['y>=2','y<=1'],(-3,3,-3,3),(target,),'https://study.example/images',101,font)
            self.assertEqual(empty['status'],'no_visible_region');self.assertEqual(list(target.iterdir()),[])
            clipped=plot_region(['y>=x'],(-2,2,-2,2),(target,),'https://study.example/images',101,font)
            self.assertTrue(clipped['touches_plot_edge']);self.assertEqual(clipped['status'],'plotted')

    def test_images_are_persisted_and_different_conditions_get_different_names(self):
        with tempfile.TemporaryDirectory() as directory:
            targets=(Path(directory)/'source',Path(directory)/'served');font=FONT if FONT.exists() else None
            first=plot_region(['x**2+y**2<=4','y>=x'],(-2.5,2.5,-2.5,2.5),targets,'https://study.example/images',101,font)
            again=plot_region(['x**2+y**2<=4','y>=x'],(-2.5,2.5,-2.5,2.5),targets,'https://study.example/images',101,font)
            second=plot_region(['y>=x**2','y<=2*x'],(-.5,2.5,-.5,4.5),targets,'https://study.example/images',101,font)
            self.assertEqual(first['url'],again['url']);self.assertNotEqual(first['url'],second['url'])
            for result in [first,second]:
                name=result['url'].rsplit('/',1)[1];data=(targets[0]/name).read_bytes()
                self.assertEqual(data[:8],b'\x89PNG\r\n\x1a\n');self.assertEqual(data,(targets[1]/name).read_bytes())
            self.assertFalse(any(targets[0].glob('*.tmp')))

    def test_window_errors_are_reported(self):
        for bounds in [(2,1,0,1),(0,1,float('nan'),2),(0,1,0,1e9)]:
            with self.assertRaises(PlotInputError):sample_region(['y>=x'],bounds,101)

    def test_coordinate_limits_do_not_reclassify_curves(self):
        for text, expected in [('x>=0', (0, 0)), ('1>=x', (0, 1)), ('2*x-2<=0', (0, 1)), ('y<2', (1, 2)), ('y>=x**2', None), ('x**2+y**2<=4', None)]:
            with self.subTest(text=text):
                self.assertEqual(coordinate_limit(Condition.parse(text)), expected)

    def test_sqrt_region_omits_axis_overlay_and_uses_one_finite_dashed_limit(self):
        conditions = ['y>=x**2', 'y<=sqrt(x)', 'x>=0', 'x<=1']
        bounds = (-.35, 1.35, -.35, 1.35)
        original = sample_region(conditions, bounds, 401)[-1]
        without_redundant_limits = sample_region(conditions[:2], bounds, 401)[-1]
        np.testing.assert_array_equal(original, without_redundant_limits)
        for guides in [(), ((0., 0.), (1., 1.), (1., 1.))]:
            with self.subTest(guides=guides), tempfile.TemporaryDirectory() as directory:
                figure = Figure(figsize=(8, 8), dpi=160)
                with patch('region_plot.Figure', return_value=figure):
                    result = plot_region(conditions, bounds, (Path(directory),), 'https://study.example/images', 401, None, guides)
                self.assertEqual(result['conditions'], conditions)
                self.assertEqual(len(figure.texts), 0)
                self.assertEqual(len(figure.axes), 1)
                self.assertNotIn('点击查看高清图', result['markdown'])
                axes = figure.axes[0]
                self.assertEqual(len(axes.lines), 1)
                guide = axes.lines[0]
                self.assertEqual(guide.get_color(), '#6B7280')
                self.assertTrue(guide.is_dashed())
                np.testing.assert_allclose(guide.get_xdata(), [1, 1])
                np.testing.assert_allclose(guide.get_ydata(), [0, 1], atol=1e-8)
                self.assertFalse(any(text.get_text().startswith(('x =', 'x=')) for text in axes.texts))
                self.assertEqual(sum(text.get_text() == '0' for text in axes.get_xticklabels() + axes.get_yticklabels()), 1)
                zero = next(text for text in axes.get_xticklabels() if text.get_text() == '0')
                self.assertLess(zero.get_window_extent().x1, axes.transData.transform((0, 0))[0])
                self.assertEqual(sum(text.get_text() == '1' for text in axes.get_xticklabels()), 1)

    def test_true_constraints_still_clip_shading_and_horizontal_axis_is_not_redrawn(self):
        conditions = ['x>0', 'x<=1', 'y>=0', 'y<=2']
        parsed, _, _, _, mask = sample_region(conditions, (-.5, 1.5, -.5, 2.5), 401)
        self.assertFalse(parsed[0].contains(np.array([0.]), np.array([1.]))[0])
        self.assertAlmostEqual(mask.sum() * (2 / 400) * (3 / 400), 2, delta=.03)
        with tempfile.TemporaryDirectory() as directory:
            figure = Figure(figsize=(8, 8), dpi=160)
            with patch('region_plot.Figure', return_value=figure):
                plot_region(conditions, (-.5, 1.5, -.5, 2.5), (Path(directory),), 'https://study.example/images', 401, None)
            axes = figure.axes[0]
            self.assertEqual(len(axes.lines), 2)
            self.assertTrue(all(line.is_dashed() and line.get_color() == '#6B7280' for line in axes.lines))
            self.assertEqual(len(axes.texts), 0)


class RegionProtocolTests(unittest.IsolatedAsyncioTestCase):
    async def test_configured_mcp_tool_creates_a_real_image(self):
        with tempfile.TemporaryDirectory() as directory:
            target=Path(directory)
            settings=Settings(ROOT/'apps/web/axisverse-mcp/data/verified-excerpts.json',5,200,'https://study.example/images',(target,),FONT if FONT.exists() else None,101)
            async with Client(build_server(settings)) as client:
                self.assertIn('plot_integral_region',{tool.name for tool in (await client.list_tools()).tools})
                result=await client.call_tool('plot_integral_region',{'inequalities':['x**2+y**2<=4','y>=x'],'x_min':-2.5,'x_max':2.5,'y_min':-2.5,'y_max':2.5})
                self.assertFalse(result.is_error);self.assertEqual(result.structured_content['status'],'plotted')
                self.assertEqual(len(list(target.glob('region-*.png'))),1)
                guided=await client.call_tool('plot_integral_region',{'inequalities':['y>=x**2','y<=2-x'],'x_min':-2.6,'x_max':1.6,'y_min':-.6,'y_max':4.6,'integration_guides':[{'x':-2,'y':4},{'x':1,'y':1}]})
                self.assertFalse(guided.is_error)
                self.assertEqual(guided.structured_content['conditions'],['y>=x**2','y<=2-x'])
                self.assertEqual(guided.structured_content['integration_guides'],[{'x':-2.0,'y':4.0,'to_y':0},{'x':1.0,'y':1.0,'to_y':0}])
                outside=await client.call_tool('plot_integral_region',{'inequalities':['y>=x**2','y<=2-x'],'x_min':-2.6,'x_max':1.6,'y_min':-.6,'y_max':4.6,'integration_guides':[{'x':1,'y':9}]})
                self.assertTrue(outside.is_error)
                bad=await client.call_tool('plot_integral_region',{'inequalities':['x[0] < y'],'x_min':-2,'x_max':2,'y_min':-2,'y_max':2})
                self.assertTrue(bad.is_error)


if __name__=='__main__':unittest.main()
