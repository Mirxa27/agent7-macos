#!/usr/bin/env python3
"""
Agent7 Multi-Modal Input System
Handles voice, vision, and file inputs
"""

import asyncio
import base64
import io
import wave
import tempfile
import os
from typing import Dict, Any, Optional, Callable
from dataclasses import dataclass
from enum import Enum
import logging

import numpy as np
from PIL import Image
import speech_recognition as sr

logger = logging.getLogger(__name__)


class InputType(Enum):
    TEXT = "text"
    VOICE = "voice"
    IMAGE = "image"
    VIDEO = "video"
    FILE = "file"
    SCREENSHOT = "screenshot"


@dataclass
class MultiModalInput:
    type: InputType
    content: Any
    metadata: Dict[str, Any]
    timestamp: float


class VoiceProcessor:
    """Voice input processing with speech-to-text"""

    def __init__(self):
        self.recognizer = sr.Recognizer()
        self.microphone = sr.Microphone()
        self.is_listening = False
        self.audio_buffer = []

    async def start_continuous_listening(self, callback: Callable[[str], None]):
        """Start continuous voice listening"""
        self.is_listening = True

        with self.microphone as source:
            self.recognizer.adjust_for_ambient_noise(source)

        while self.is_listening:
            try:
                with self.microphone as source:
                    audio = self.recognizer.listen(
                        source, timeout=1, phrase_time_limit=10
                    )

                # Transcribe
                text = await self.transcribe_audio(audio)
                if text:
                    callback(text)

            except sr.WaitTimeoutError:
                continue
            except Exception as e:
                logger.error(f"Voice listening error: {e}")

    async def transcribe_audio(self, audio_data) -> str:
        """Transcribe audio to text using Whisper or Google Speech"""
        try:
            # Try Google's speech recognition first (fast, free)
            text = self.recognizer.recognize_google(audio_data)
            return text
        except sr.UnknownValueError:
            return ""
        except sr.RequestError as e:
            logger.error(f"Speech recognition error: {e}")
            return ""

    async def transcribe_file(self, audio_path: str) -> str:
        """Transcribe audio file"""
        try:
            with sr.AudioFile(audio_path) as source:
                audio = self.recognizer.record(source)
            return await self.transcribe_audio(audio)
        except Exception as e:
            logger.error(f"Audio file transcription error: {e}")
            return ""

    def stop_listening(self):
        """Stop continuous listening"""
        self.is_listening = False


class VisionProcessor:
    """Advanced vision processing for UI understanding"""

    def __init__(self):
        self.frame_buffer = []

    async def process_image(
        self, image_data: bytes, context: str = ""
    ) -> Dict[str, Any]:
        """Process image and extract information"""
        try:
            # Load image
            image = Image.open(io.BytesIO(image_data))

            # Get basic info
            width, height = image.size
            format_type = image.format

            # Convert to OpenCV for analysis
            cv_image = cv2.cvtColor(np.array(image), cv2.COLOR_RGB2BGR)

            # Detect UI elements
            elements = await self.detect_ui_elements(cv_image)

            # Analyze layout
            layout = await self.analyze_layout(cv_image)

            return {
                "success": True,
                "dimensions": {"width": width, "height": height},
                "format": format_type,
                "elements": elements,
                "layout": layout,
                "context": context,
            }

        except Exception as e:
            logger.error(f"Image processing error: {e}")
            return {"success": False, "error": str(e)}

    async def detect_ui_elements(self, image: np.ndarray) -> list:
        """Detect UI elements in image"""
        elements = []

        try:
            # Convert to grayscale
            gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)

            # Edge detection
            edges = cv2.Canny(gray, 50, 150)

            # Find contours
            contours, _ = cv2.findContours(
                edges, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE
            )

            # Analyze each contour
            for i, contour in enumerate(contours[:30]):  # Limit to top 30
                x, y, w, h = cv2.boundingRect(contour)

                # Filter small elements
                if w > 20 and h > 20:
                    aspect_ratio = w / float(h)
                    area = w * h

                    # Classify element
                    element_type = self.classify_element(aspect_ratio, w, h, area)

                    elements.append(
                        {
                            "id": i,
                            "type": element_type,
                            "bbox": {"x": x, "y": y, "width": w, "height": h},
                            "center": {"x": x + w // 2, "y": y + h // 2},
                            "area": area,
                            "aspect_ratio": aspect_ratio,
                        }
                    )

            # Sort by size (largest first)
            elements.sort(key=lambda x: x["area"], reverse=True)

        except Exception as e:
            logger.error(f"UI detection error: {e}")

        return elements

    def classify_element(
        self, aspect_ratio: float, width: int, height: int, area: int
    ) -> str:
        """Classify UI element type"""
        if 0.8 < aspect_ratio < 1.2 and width < 100 and height < 100:
            return "button"
        elif aspect_ratio > 3 and height < 50:
            return "input_field"
        elif aspect_ratio < 0.3:
            return "scrollbar"
        elif area > 50000:
            return "content_area"
        elif width < 50 and height < 50:
            return "icon"
        else:
            return "container"

    async def analyze_layout(self, image: np.ndarray) -> Dict[str, Any]:
        """Analyze page layout"""
        height, width = image.shape[:2]

        return {
            "screen_size": {"width": width, "height": height},
            "regions": [
                {"name": "header", "y_range": [0, int(height * 0.15)]},
                {
                    "name": "main_content",
                    "y_range": [int(height * 0.15), int(height * 0.85)],
                },
                {"name": "footer", "y_range": [int(height * 0.85), height]},
            ],
        }

    async def compare_images(
        self, img1_data: bytes, img2_data: bytes
    ) -> Dict[str, Any]:
        """Compare two images and detect changes"""
        try:
            img1 = Image.open(io.BytesIO(img1_data))
            img2 = Image.open(io.BytesIO(img2_data))

            # Convert to numpy arrays
            arr1 = np.array(img1)
            arr2 = np.array(img2)

            # Ensure same size
            if arr1.shape != arr2.shape:
                return {"error": "Images have different dimensions"}

            # Calculate difference
            diff = cv2.absdiff(arr1, arr2)
            gray_diff = cv2.cvtColor(diff, cv2.COLOR_RGB2GRAY)

            # Threshold
            _, thresh = cv2.threshold(gray_diff, 30, 255, cv2.THRESH_BINARY)

            # Find changed areas
            contours, _ = cv2.findContours(
                thresh, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE
            )

            changes = []
            for contour in contours:
                if cv2.contourArea(contour) > 100:  # Filter small changes
                    x, y, w, h = cv2.boundingRect(contour)
                    changes.append(
                        {
                            "bbox": {"x": x, "y": y, "width": w, "height": h},
                            "area": cv2.contourArea(contour),
                        }
                    )

            return {
                "success": True,
                "changes_detected": len(changes),
                "changes": changes,
                "total_change_area": sum(c["area"] for c in changes),
            }

        except Exception as e:
            logger.error(f"Image comparison error: {e}")
            return {"success": False, "error": str(e)}


class FileProcessor:
    """Process various file types"""

    SUPPORTED_TYPES = {
        "text": [".txt", ".md", ".json", ".xml", ".csv", ".log"],
        "code": [
            ".py",
            ".js",
            ".ts",
            ".html",
            ".css",
            ".java",
            ".cpp",
            ".c",
            ".h",
            ".go",
            ".rs",
        ],
        "document": [".pdf", ".doc", ".docx"],
        "image": [".jpg", ".jpeg", ".png", ".gif", ".bmp", ".webp"],
        "audio": [".wav", ".mp3", ".m4a", ".ogg"],
        "video": [".mp4", ".avi", ".mov", ".mkv"],
        "data": [".json", ".xml", ".yaml", ".yml", ".csv", ".xlsx"],
    }

    async def process_file(self, file_path: str) -> Dict[str, Any]:
        """Process file and extract content"""
        try:
            ext = os.path.splitext(file_path)[1].lower()
            file_type = self.get_file_type(ext)

            if file_type == "text" or file_type == "code":
                content = await self.read_text_file(file_path)
                return {
                    "success": True,
                    "type": file_type,
                    "content": content,
                    "metadata": {"lines": content.count("\n")},
                }

            elif file_type == "image":
                with open(file_path, "rb") as f:
                    image_data = f.read()
                return {
                    "success": True,
                    "type": "image",
                    "data": base64.b64encode(image_data).decode("utf-8"),
                    "format": ext[1:],
                }

            elif file_type == "audio":
                return {
                    "success": True,
                    "type": "audio",
                    "path": file_path,
                    "format": ext[1:],
                }

            elif file_type == "pdf":
                return await self.process_pdf(file_path)

            else:
                return {"success": False, "error": f"Unsupported file type: {ext}"}

        except Exception as e:
            logger.error(f"File processing error: {e}")
            return {"success": False, "error": str(e)}

    def get_file_type(self, ext: str) -> str:
        """Determine file type from extension"""
        for file_type, extensions in self.SUPPORTED_TYPES.items():
            if ext in extensions:
                return file_type
        return "unknown"

    async def read_text_file(self, file_path: str) -> str:
        """Read text file"""
        with open(file_path, "r", encoding="utf-8", errors="ignore") as f:
            return f.read()

    async def process_pdf(self, file_path: str) -> Dict[str, Any]:
        """Extract text from PDF"""
        try:
            import PyPDF2

            with open(file_path, "rb") as f:
                reader = PyPDF2.PdfReader(f)
                text = ""
                for page in reader.pages:
                    text += page.extract_text() + "\n"

            return {
                "success": True,
                "type": "document",
                "content": text,
                "metadata": {"pages": len(reader.pages)},
            }
        except Exception as e:
            return {"success": False, "error": str(e)}


class MultiModalHandler:
    """Handle all multi-modal inputs"""

    def __init__(self):
        self.voice = VoiceProcessor()
        self.vision = VisionProcessor()
        self.files = FileProcessor()
        self.input_handlers = {
            InputType.TEXT: self.handle_text,
            InputType.VOICE: self.handle_voice,
            InputType.IMAGE: self.handle_image,
            InputType.FILE: self.handle_file,
            InputType.SCREENSHOT: self.handle_screenshot,
        }

    async def process_input(self, input_data: MultiModalInput) -> Dict[str, Any]:
        """Process any type of input"""
        handler = self.input_handlers.get(input_data.type)
        if handler:
            return await handler(input_data)
        return {"error": f"Unknown input type: {input_data.type}"}

    async def handle_text(self, input_data: MultiModalInput) -> Dict[str, Any]:
        """Handle text input"""
        return {
            "success": True,
            "type": "text",
            "content": input_data.content,
            "length": len(input_data.content),
        }

    async def handle_voice(self, input_data: MultiModalInput) -> Dict[str, Any]:
        """Handle voice input"""
        audio_data = input_data.content

        # If it's a file path
        if isinstance(audio_data, str) and os.path.exists(audio_data):
            text = await self.voice.transcribe_file(audio_data)
        else:
            # Assume it's audio data
            text = "Voice processing requires file path"

        return {
            "success": True,
            "type": "voice",
            "transcription": text,
            "original_type": input_data.metadata.get("format", "unknown"),
        }

    async def handle_image(self, input_data: MultiModalInput) -> Dict[str, Any]:
        """Handle image input"""
        image_data = input_data.content

        # If it's base64 encoded
        if isinstance(image_data, str):
            image_data = base64.b64decode(image_data)

        result = await self.vision.process_image(
            image_data, context=input_data.metadata.get("context", "")
        )

        return result

    async def handle_screenshot(self, input_data: MultiModalInput) -> Dict[str, Any]:
        """Handle screenshot input"""
        # Similar to image but with UI context
        result = await self.handle_image(input_data)
        result["is_screenshot"] = True
        return result

    async def handle_file(self, input_data: MultiModalInput) -> Dict[str, Any]:
        """Handle file input"""
        file_path = input_data.content
        return await self.files.process_file(file_path)

    async def start_voice_listener(self, callback: Callable[[str], None]):
        """Start listening for voice input"""
        await self.voice.start_continuous_listening(callback)

    def stop_voice_listener(self):
        """Stop voice listener"""
        self.voice.stop_listening()


# Export
__all__ = [
    "MultiModalHandler",
    "MultiModalInput",
    "InputType",
    "VoiceProcessor",
    "VisionProcessor",
    "FileProcessor",
]
