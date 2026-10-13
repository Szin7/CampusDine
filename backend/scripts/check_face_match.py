import argparse
from pathlib import Path

import numpy as np

from app.face_matching import (FaceEngineUnavailable, InvalidFacePhoto, MAX_PHOTO_BYTES,
                               encode_face_photo, match_student_encoding)


def read_photo(path: Path) -> bytes:
    with path.open("rb") as photo:
        return photo.read(MAX_PHOTO_BYTES + 1)


def main():
    parser = argparse.ArgumentParser(description="Check an enrollment photo against a counter capture without saving either.")
    parser.add_argument("enrollment", type=Path)
    parser.add_argument("capture", type=Path)
    parser.add_argument("--tolerance", type=float, default=0.5)
    args = parser.parse_args()
    try:
        enrolled = encode_face_photo(read_photo(args.enrollment))
        captured = encode_face_photo(read_photo(args.capture))
        result = match_student_encoding(captured, [(1, enrolled)], tolerance=args.tolerance)
    except (OSError, InvalidFacePhoto, FaceEngineUnavailable, ValueError) as exc:
        parser.exit(1, f"{exc}\n")
    distance = np.linalg.norm(np.frombuffer(enrolled, dtype="<f8") - np.frombuffer(captured, dtype="<f8"))
    print(f"Distance: {distance:.4f}; cutoff: {args.tolerance:.4f}")
    print("Match" if result else "No match")
    print("Distance is not a confidence percentage. Test different photos and different people.")


if __name__ == "__main__":
    main()
