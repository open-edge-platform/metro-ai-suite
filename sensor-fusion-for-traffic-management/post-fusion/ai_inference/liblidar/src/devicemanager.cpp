#include <devicemanager.hpp>
#include <stdexcept>
void DeviceManager::printDevices()
{
    std::cout << "Available device(s): \n";
    for (auto &d : devs) {
        std::cout << "\tName: " << d.get_info<sycl::info::device::name>() << "," << "Platform: " << d.get_platform().get_info<sycl::info::platform::name>()
                  << ", " << "Backend: " << d.get_backend() << std::endl;
    }
}
DeviceManager::DeviceManager()
{
    for (auto &p : sycl::platform::get_platforms()) {
        for (auto &d : p.get_devices()) {
            devs.push_back(d);
        }
    }
    printDevices();
}
sycl::queue &DeviceManager::getQue()
{
    return que;
}
sycl::device &DeviceManager::getDev()
{
    if (selDevIdx < 0 || static_cast<size_t>(selDevIdx) >= devs.size())
        throw std::runtime_error("No SYCL device has been selected");
    return devs[selDevIdx];
}
bool DeviceManager::SelectDevice(int idx, sycl::info::device_type type)
{
    if (idx < 0 || static_cast<size_t>(idx) >= devs.size() ||
        devs[idx].get_info<sycl::info::device::device_type>() != type)
        return false;
    return SelectDevice(idx);
}
bool DeviceManager::SelectDevice(int idx)
{
    if (idx >= 0 && idx < devs.size())
        selDevIdx = idx;
    else
        return false;
    auto exception_handler = [](sycl::exception_list exceptions) {
        for (std::exception_ptr const &e : exceptions) {
            try {
                std::rethrow_exception(e);
            }
            catch (sycl::exception const &e) {
                std::cout << "Caught asynchronous SYCL exception:\n";
                std::cout << e.what() << std::endl;
            }
        }
    };
    que = sycl::queue(devs[selDevIdx], sycl::property::queue::in_order{});
    return true;
}
