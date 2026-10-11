"""Exercise the material service through MCP, including the real stdio process."""

import json
from pathlib import Path
import shutil
import sys
import tempfile
import unittest

from mcp import Client, StdioServerParameters

SERVER_DIR = Path(__file__).resolve().parents[1]
ROOT = SERVER_DIR.parents[2]
sys.path.insert(0, str(SERVER_DIR))
from server import MaterialCatalog, Settings, build_server


class MaterialServiceTests(unittest.IsolatedAsyncioTestCase):
    """Each test owns a temporary corpus; SDK contexts own transport teardown."""

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="axisverse-mcp-")
        self.addCleanup(self.temp.cleanup)
        self.corpus = Path(self.temp.name) / "materials.json"
        shutil.copyfile(ROOT / "output/pdf/教材第九章-检索材料.json", self.corpus)
        self.settings = Settings(self.corpus, max_results=5, max_query_chars=200)

    async def test_stdio_discovers_and_returns_verified_source(self):
        params = StdioServerParameters(command=sys.executable, args=["-X", "utf8", str(SERVER_DIR / "server.py"), "--corpus", str(self.corpus)])
        async with Client(params, read_timeout_seconds=30) as client:
            names = {tool.name for tool in (await client.list_tools()).tools}
            self.assertEqual(names, {"list_course_materials", "search_course_materials"})
            result = await client.call_tool("search_course_materials", {"query": "球坐标", "book_page": 162})
            self.assertFalse(result.is_error)
            data = result.structured_content
            self.assertEqual(data["status"], "found")
            hit = data["excerpts"][0]
            self.assertEqual(hit["id"], "TB09-162")
            self.assertEqual(hit["pdf_pages"], [33])
            self.assertIn(r"r^2\sin\theta", hit["text"])
            self.assertFalse(hit["is_full_page_transcription"])

    async def test_no_results_does_not_return_unrelated_sources(self):
        async with Client(build_server(self.settings)) as client:
            for arguments in [{"query": "傅里叶级数"}, {"query": "习题9.2第4题", "book_page": 153}, {"query": "南京理工大学今年考试范围"}]:
                result = await client.call_tool("search_course_materials", arguments)
                self.assertFalse(result.is_error)
                self.assertEqual(result.structured_content["status"], "no_results")
                self.assertEqual(result.structured_content["excerpts"], [])

    async def test_missing_storage_is_error_not_no_results(self):
        async with Client(build_server(self.settings)) as client:
            self.corpus.unlink()
            result = await client.call_tool("search_course_materials", {"query": "球坐标"})
            self.assertTrue(result.is_error)
            self.assertIn("服务错误", result.content[0].text)

    async def test_query_limits_reject_invalid_tool_input(self):
        async with Client(build_server(self.settings)) as client:
            for args in [{"query": " "}, {"query": "球坐标", "limit": 6}, {"query": "球坐标", "book_page": 999}, {"query": "球" * 201}]:
                result = await client.call_tool("search_course_materials", args)
                self.assertTrue(result.is_error)

    def test_invalid_page_mapping_and_duplicate_ids_fail_loading(self):
        original = json.loads(self.corpus.read_text(encoding="utf8"))
        for change in ["pages", "duplicate"]:
            data = json.loads(json.dumps(original))
            if change == "pages":
                data["chunks"][0]["pdf_pages"] = [50]
            else:
                data["chunks"].append(data["chunks"][0])
            self.corpus.write_text(json.dumps(data), encoding="utf8")
            with self.assertRaisesRegex(Exception, "内容无效"):
                MaterialCatalog(self.settings)

    def test_page_lookup_includes_multi_page_excerpts_and_honors_limit(self):
        catalog = MaterialCatalog(self.settings)
        result = catalog.search("第147页", None, 1)
        self.assertEqual(result["status"], "found")
        self.assertEqual(result["matched_count"], 2)
        self.assertEqual(result["returned_count"], 1)
        self.assertTrue(result["has_more"])

    async def test_sphere_search_returns_two_deployable_original_diagrams(self):
        settings = Settings(self.corpus, 5, 200, "https://study.example/diagrams/")
        async with Client(build_server(settings)) as client:
            result = await client.call_tool("search_course_materials", {"query": "球坐标", "book_page": 162})
            pictures = result.structured_content["excerpts"][0]["illustrations"]
            self.assertEqual(len(pictures), 2)
            for picture in pictures:
                self.assertTrue(picture["url"].startswith("https://study.example/diagrams/"))
                self.assertIn(picture["url"], picture["markdown"])
                self.assertEqual(picture["source"], "original_teaching_diagram_not_textbook_scan")
                asset = ROOT / "apps/web/public/axisverse/diagrams" / picture["url"].rsplit("/", 1)[-1]
                self.assertEqual(asset.read_bytes()[:8], b"\x89PNG\r\n\x1a\n")

    def test_unillustrated_excerpt_does_not_claim_a_diagram(self):
        catalog = MaterialCatalog(self.settings)
        result = catalog.search("质心", 171, 1)
        self.assertEqual(result["excerpts"][0]["illustrations"], [])
        self.assertEqual(catalog.search("习题", 153, 1)["excerpts"], [])

    def test_diagram_paths_and_base_urls_reject_invalid_configuration(self):
        for base in ["file:///tmp/images", "https://example.test/x?token=secret", "https://user:pass@example.test/x"]:
            with self.assertRaisesRegex(ValueError, "Asset base URL"):
                MaterialCatalog(Settings(self.corpus, 5, 200, base))
        data = json.loads(self.corpus.read_text(encoding="utf8"))
        illustrated = next(chunk for chunk in data["chunks"] if chunk["id"] == "TB09-162")
        illustrated["illustrations"][0]["file"] = "../outside.png"
        self.corpus.write_text(json.dumps(data), encoding="utf8")
        with self.assertRaisesRegex(Exception, "内容无效"):
            MaterialCatalog(self.settings)


if __name__ == "__main__":
    unittest.main()
