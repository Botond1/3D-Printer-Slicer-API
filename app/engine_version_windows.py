"""Read the actual Windows executable VERSIONINFO; native output rechecks it at slice."""
import ctypes
import json
import re
import sys
from ctypes import wintypes


def executable_version(filename):
    api = ctypes.WinDLL("version", use_last_error=True)
    api.GetFileVersionInfoSizeW.argtypes = [wintypes.LPCWSTR, ctypes.POINTER(wintypes.DWORD)]
    api.GetFileVersionInfoW.argtypes = [wintypes.LPCWSTR, wintypes.DWORD, wintypes.DWORD, ctypes.c_void_p]
    api.VerQueryValueW.argtypes = [ctypes.c_void_p, wintypes.LPCWSTR, ctypes.POINTER(ctypes.c_void_p), ctypes.POINTER(wintypes.UINT)]
    size = api.GetFileVersionInfoSizeW(filename, None)
    if not size or size > 1048576:
        raise ValueError("native_version_resource_unavailable")
    data = ctypes.create_string_buffer(size)
    if not api.GetFileVersionInfoW(filename, 0, size, data):
        raise ValueError("native_version_resource_unavailable")
    pointer = ctypes.c_void_p()
    length = wintypes.UINT()
    if not api.VerQueryValueW(data, "\\VarFileInfo\\Translation", ctypes.byref(pointer), ctypes.byref(length)):
        raise ValueError("native_version_translation_unavailable")
    translation = ctypes.cast(pointer, ctypes.POINTER(wintypes.WORD))
    query = f"\\StringFileInfo\\{translation[0]:04x}{translation[1]:04x}\\FileVersion"
    if not api.VerQueryValueW(data, query, ctypes.byref(pointer), ctypes.byref(length)):
        raise ValueError("native_version_unavailable")
    value = ctypes.wstring_at(pointer, length.value).rstrip("\0").strip()
    if not re.fullmatch(r"[0-9]+(?:\.[0-9]+){2,3}", value):
        raise ValueError("native_version_invalid")
    return value


if __name__ == "__main__":
    print(json.dumps({"version": executable_version(sys.argv[1]), "source": "windows_versioninfo"}))
