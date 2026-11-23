#pragma once
#include <sycl/sycl.hpp>
#include <iostream>
#include <vector>
class DeviceManager {
  public:
    void printDevices();
    bool SelectDevice(int idx);
    bool SelectDevice(int idx, sycl::info::device_type type);
    sycl::queue &getQue();
    sycl::device &getDev();

  public:
    DeviceManager();
    DeviceManager(const DeviceManager &) = delete;
    DeviceManager &operator=(const DeviceManager &) = delete;
    DeviceManager(DeviceManager &&) = delete;
    DeviceManager &operator=(DeviceManager &&) = delete;

  private:
    std::vector<sycl::device> devs;
    sycl::queue que;
    int selDevIdx = -1;
};
