"""通过 BlueZ D-Bus 验证 M19 的 GATT 发现、读写和订阅。"""

import argparse
import time

from gi.repository import Gio, GLib

BLUEZ = "org.bluez"
PROPERTIES = "org.freedesktop.DBus.Properties"
ADAPTER = BLUEZ + ".Adapter1"
DEVICE = BLUEZ + ".Device1"
SERVICE = BLUEZ + ".GattService1"
CHARACTERISTIC = BLUEZ + ".GattCharacteristic1"
DESCRIPTOR = BLUEZ + ".GattDescriptor1"
SERVICE_UUID = "d0f10000-98cb-4d61-be71-228c9171d719"
VALUE_UUID = "d0f10001-98cb-4d61-be71-228c9171d719"
CCCD_UUID = "00002902-0000-1000-8000-00805f9b34fb"
EMPTY_OPTIONS = GLib.Variant("(a{sv})", ({},))


def wait_for(check, description, seconds=15):
    deadline = time.monotonic() + seconds
    context = GLib.MainContext.default()
    while time.monotonic() < deadline:
        while context.pending():
            context.iteration(False)
        result = check()
        if result:
            return result
        time.sleep(0.05)
    raise TimeoutError(description)


def require(condition, description):
    if not condition:
        raise RuntimeError(description)


def call(bus, path, interface, method, args=None):
    reply = bus.call_sync(
        BLUEZ, path, interface, method, args, None, Gio.DBusCallFlags.NONE, 15000, None
    )
    return reply.unpack()


def property_of(bus, path, interface, prop):
    return call(bus, path, PROPERTIES, "Get", GLib.Variant("(ss)", (interface, prop)))[0]


def objects_of(bus):
    return call(bus, "/", "org.freedesktop.DBus.ObjectManager", "GetManagedObjects")[0]


def discover(bus, adapter, address, name):
    def advertised_device():
        for path, interfaces in objects_of(bus).items():
            props = interfaces.get(DEVICE, {})
            if (props.get("Adapter") == adapter and props.get("Address") == address
                    and props.get("Name") == name and "RSSI" in props):
                return path
        return None

    call(bus, adapter, ADAPTER, "SetDiscoveryFilter", GLib.Variant("(a{sv})", ({
        "Transport": GLib.Variant("s", "le"),
        "Pattern": GLib.Variant("s", address),
    },)))
    call(bus, adapter, ADAPTER, "StartDiscovery")
    try:
        return wait_for(advertised_device, f"未发现 {address} 的 {name} 广播")
    finally:
        call(bus, adapter, ADAPTER, "StopDiscovery")


def verify(bus, adapter, address, name="M19-GATT"):
    from functools import partial

    get = partial(property_of, bus)
    call_bound = partial(call, bus)
    device = discover(bus, adapter, address, name)
    print(f"发现 {name} {address}", flush=True)
    require(not get(device, DEVICE, "Connected"), "设备已有连接，请先结束该测试会话")
    call_bound(device, DEVICE, "Connect")
    try:
        wait_for(lambda: get(device, DEVICE, "ServicesResolved"), "BlueZ 服务发现未完成")
        tree = objects_of(bus)
        service = next(
            path for path, interfaces in tree.items()
            if (props := interfaces.get(SERVICE, {})).get("Device") == device
            and props.get("UUID") == SERVICE_UUID and props.get("Primary")
        )
        char = next(
            path for path, interfaces in tree.items()
            if (props := interfaces.get(CHARACTERISTIC, {})).get("Service") == service
            and props.get("UUID") == VALUE_UUID
        )
        cccd = next(
            path for path, interfaces in tree.items()
            if (props := interfaces.get(DESCRIPTOR, {})).get("Characteristic") == char
            and props.get("UUID") == CCCD_UUID
        )

        def configuration():
            return bytes(call_bound(cccd, DESCRIPTOR, "ReadValue", EMPTY_OPTIONS)[0])

        def read():
            return bytes(call_bound(char, CHARACTERISTIC, "ReadValue", EMPTY_OPTIONS)[0])

        def write(value, mode):
            call_bound(char, CHARACTERISTIC, "WriteValue", GLib.Variant(
                "(aya{sv})", (value, {"type": GLib.Variant("s", mode)})
            ))

        require(read() == b"ready", "初始值与固件不符")
        require(configuration() == b"\x00\x00", "新连接的 CCCD 初始值应为 0")
        print("服务、特征、CCCD 发现成功，初始值 ready", flush=True)
        notifications = []

        def changed(_bus, _sender, _path, _interface, _name, parameters):
            interface, props, _ = parameters.unpack()
            if interface == CHARACTERISTIC and "Value" in props:
                notifications.append(bytes(props["Value"]))

        subscription = bus.signal_subscribe(
            BLUEZ, PROPERTIES, "PropertiesChanged", char, CHARACTERISTIC,
            Gio.DBusSignalFlags.NONE, changed,
        )
        try:
            call_bound(char, CHARACTERISTIC, "StartNotify")
            require(get(char, CHARACTERISTIC, "Notifying"), "BlueZ 尚未进入通知状态")
            try:
                require(configuration() == b"\x01\x00", "板端 CCCD 未启用通知")
                for value, mode in [(bytes(range(61)), "request"), (b"write-command", "command")]:
                    notifications.clear()
                    write(value, mode)
                    wait_for(lambda: value in notifications, f"{mode} 未收到对应通知")
                    require(read() == value, f"{mode} 回读内容与写入不一致")
                    print(f"{mode} 写入 / 回读 / 通知一致，{len(value)} 字节", flush=True)
            finally:
                call_bound(char, CHARACTERISTIC, "StopNotify")
            require(not get(char, CHARACTERISTIC, "Notifying"), "BlueZ 未结束通知状态")
            require(configuration() == b"\x00\x00", "板端 CCCD 未取消通知")
            write(b"unsubscribed", "request")
            require(read() == b"unsubscribed", "取消订阅后读写失败")
            print("取消订阅后读写正常", flush=True)
        finally:
            bus.signal_unsubscribe(subscription)
    finally:
        call_bound(device, DEVICE, "Disconnect")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("address", type=str.upper)
    parser.add_argument("--adapter", default="/org/bluez/hci0")
    args = parser.parse_args()
    bus = Gio.bus_get_sync(Gio.BusType.SYSTEM, None)
    verify(bus, args.adapter, args.address)


if __name__ == "__main__":
    main()
