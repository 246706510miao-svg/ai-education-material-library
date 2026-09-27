from pathlib import Path

import fitz


def create_text_pdf(path: Path) -> Path:
    document = fitz.open()
    first_page = document.new_page()
    first_page.insert_text((72, 72), "Double integral definition and region D.")
    second_page = document.new_page()
    second_page.insert_text((72, 72), "Change the order of integration.")
    document.save(path)
    document.close()
    return path


def create_image_only_pdf(path: Path) -> Path:
    document = fitz.open()
    document.new_page()
    document.save(path)
    document.close()
    return path

