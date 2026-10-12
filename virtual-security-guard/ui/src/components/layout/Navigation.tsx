// SPDX-FileCopyrightText: (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0
import type { ComponentProps } from "react";
import { NavLink } from "react-router";
import { navItems } from "@/config/navigation";
import { cn } from "@/lib/utils";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { useInvestigationStore } from "@/stores/investigation";
import { StatusFooter } from "./StatusFooter";
import { VsgMark } from "./VsgMark";

export function Navigation(props: ComponentProps<typeof Sidebar>) {
  const busy = useInvestigationStore((s) => s.busy);
  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              asChild
              className="h-[3.75rem] pl-[0.4375rem] hover:bg-transparent active:bg-transparent group-data-[collapsible=icon]:!h-[2.75rem] group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:!p-0"
            >
              <NavLink to="/argus" aria-label="Virtual Security Guard home">
                <VsgMark className="!size-9 group-data-[collapsible=icon]:!size-8" />
                <span className="font-semibold text-base leading-tight group-data-[collapsible=icon]:hidden">
                  Virtual Security Guard
                </span>
              </NavLink>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent className="flex flex-col gap-2">
            <SidebarMenu>
              {navItems.map((item) => (
                <SidebarMenuItem key={item.url}>
                  <NavLink to={item.url}>
                    {({ isActive }) => (
                      <SidebarMenuButton
                        tooltip={item.title}
                        className={cn(
                          isActive &&
                            "bg-sidebar-accent border-r-3 border-brand-accent",
                        )}
                      >
                        <item.icon />
                        <span className="px-2">{item.title}</span>
                        {item.url === "/argus" && busy && (
                          <span
                            className="ml-auto size-2 rounded-full bg-pending motion-safe:animate-pulse group-data-[collapsible=icon]:absolute group-data-[collapsible=icon]:right-1 group-data-[collapsible=icon]:top-1"
                            aria-label="Argus is working"
                          />
                        )}
                      </SidebarMenuButton>
                    )}
                  </NavLink>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <StatusFooter />
      </SidebarFooter>
    </Sidebar>
  );
}
