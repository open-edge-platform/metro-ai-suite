"""Base monitor interface for video stream processors."""

from __future__ import annotations

from abc import ABC, abstractmethod


class BaseMonitor(ABC):
    @abstractmethod
    def start(self) -> None:
        pass

    @abstractmethod
    def stop(self) -> None:
        pass

    @abstractmethod
    def pause(self) -> None:
        pass

    @abstractmethod
    def resume(self) -> None:
        pass

    @property
    @abstractmethod
    def status(self) -> str:
        pass

    @property
    @abstractmethod
    def is_running(self) -> bool:
        pass
