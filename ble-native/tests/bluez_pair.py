"""为 M19 Phase D 测试板配对并执行加密重连和 GATT 验收。"""

import argparse

from gi.repository import Gio, GLib

from bluez_gatt import (
    ADAPTER, BLUEZ, DEVICE, call, discover, property_of, require, verify, wait_for,
)

AGENT_MANAGER = BLUEZ + ".AgentManager1"
AGENT_PATH = "/org/bluez/m19_phase_d_agent"
AGENT_XML = """<node>
  <interface name="org.bluez.Agent1">
    <method name="Release"/>
    <method name="Cancel"/>
    <method name="RequestAuthorization"><arg type="o" direction="in"/></method>
    <method name="AuthorizeService">
      <arg type="o" direction="in"/><arg type="s" direction="in"/>
    </method>
  </interface>
</node>"""


def pair(bus, device):
    node = Gio.DBusNodeInfo.new_for_xml(AGENT_XML)

    def handle(_bus, _sender, _path, _interface, method, parameters, invocation):
        if method in ("Release", "Cancel") or parameters.unpack()[0] == device:
            invocation.return_value(None)
        else:
            invocation.return_dbus_error(BLUEZ + ".Error.Rejected", "测试代理仅接受目标设备")

    registration = bus.register_object(AGENT_PATH, node.interfaces[0], handle)
    try:
        call(bus, "/org/bluez", AGENT_MANAGER, "RegisterAgent",
             GLib.Variant("(os)", (AGENT_PATH, "NoInputNoOutput")))
        try:
            result = []

            def finished(connection, reply):
                try:
                    connection.call_finish(reply)
                    result.append(None)
                except GLib.Error as error:
                    result.append(error)

            bus.call(BLUEZ, device, DEVICE, "Pair", None, None,
                     Gio.DBusCallFlags.NONE, 45_000, None, finished)
            wait_for(lambda: result, "BlueZ 配对超时", seconds=46)
            if result[0] is not None:
                raise result[0]
        finally:
            call(bus, "/org/bluez", AGENT_MANAGER, "UnregisterAgent",
                 GLib.Variant("(o)", (AGENT_PATH,)))
    finally:
        bus.unregister_object(registration)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("address", type=str.upper)
    parser.add_argument("--adapter", default="/org/bluez/hci0")
    parser.add_argument("--name", default="M19-SEC")
    parser.add_argument("--keep-bond", action="store_true")
    args = parser.parse_args()
    bus = Gio.bus_get_sync(Gio.BusType.SYSTEM, None)
    device = discover(bus, args.adapter, args.address, args.name)
    require(not property_of(bus, device, DEVICE, "Paired"), "测试地址已有配对记录")
    require(not property_of(bus, device, DEVICE, "Connected"), "测试地址已有活动连接")
    pair(bus, device)
    try:
        require(property_of(bus, device, DEVICE, "Paired"), "BlueZ 未报告已配对")
        require(property_of(bus, device, DEVICE, "Bonded"), "BlueZ 未保存绑定")
        print(f"BlueZ 已配对并绑定 {args.address}", flush=True)
        if property_of(bus, device, DEVICE, "Connected"):
            call(bus, device, DEVICE, "Disconnect")
            wait_for(lambda: not property_of(bus, device, DEVICE, "Connected"), "断开超时")
        verify(bus, args.adapter, args.address, name=args.name)
        print("使用绑定重连，加密 GATT 验收通过", flush=True)
    finally:
        if not args.keep_bond:
            call(bus, args.adapter, ADAPTER, "RemoveDevice", GLib.Variant("(o)", (device,)))


if __name__ == "__main__":
    main()
