from io import BytesIO
import warnings

import numpy as np
from PIL import Image, ImageOps, UnidentifiedImageError

MAX_PHOTO_BYTES = 5 * 1024 * 1024
MAX_PHOTO_PIXELS = 16_000_000


class InvalidFacePhoto(ValueError):
    pass


class FaceEngineUnavailable(RuntimeError):
    pass


def encode_face_photo(data: bytes) -> bytes:
    if not data or len(data) > MAX_PHOTO_BYTES:
        raise InvalidFacePhoto("Choose a JPEG or PNG photo smaller than 5 MB.")
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(BytesIO(data)) as source:
                if source.format not in {"JPEG", "PNG"} or source.width * source.height > MAX_PHOTO_PIXELS:
                    raise InvalidFacePhoto("Use a JPEG or PNG photo up to 16 megapixels.")
                picture = ImageOps.exif_transpose(source).convert("RGB")
                picture.thumbnail((1200, 1200))
                pixels = np.asarray(picture)
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError, Image.DecompressionBombWarning) as exc:
        raise InvalidFacePhoto("The photo could not be read. Choose another JPEG or PNG.") from exc
    try:
        import face_recognition
    except ImportError as exc:
        raise FaceEngineUnavailable("Face enrollment is unavailable on this server.") from exc
    locations = face_recognition.face_locations(pixels, model="hog")
    if len(locations) != 1:
        raise InvalidFacePhoto("The photo must contain exactly one clearly visible face.")
    encodings = face_recognition.face_encodings(pixels, known_face_locations=locations, model="small")
    if len(encodings) != 1:
        raise InvalidFacePhoto("Could not encode this face. Try a clearer front-facing photo.")
    encoding = np.asarray(encodings[0], dtype="<f8")
    if encoding.shape != (128,) or not np.isfinite(encoding).all():
        raise InvalidFacePhoto("Could not encode this face. Choose another photo.")
    return encoding.tobytes()


class AmbiguousFaceMatch(ValueError):
    pass


def match_student_encoding(probe: bytes, candidates: list[tuple[int, bytes]], *, tolerance: float = 0.5) -> int | None:
    if not 0 < tolerance <= 0.6:
        raise ValueError("Face tolerance must be greater than 0 and at most 0.6.")
    query = np.frombuffer(probe, dtype="<f8")
    if query.shape != (128,) or not np.isfinite(query).all():
        raise InvalidFacePhoto("The captured face encoding is invalid.")
    matches = []
    for student_id, stored in candidates:
        if len(stored) != 1024:
            continue
        known = np.frombuffer(stored, dtype="<f8")
        if not np.isfinite(known).all():
            continue
        distance = float(np.linalg.norm(known - query))
        if distance <= tolerance:
            matches.append(student_id)
    # Reject ambiguous matches even when one candidate is closer.
    if len(matches) > 1:
        raise AmbiguousFaceMatch("More than one student matched. Use the roll-number lookup.")
    return matches[0] if matches else None
