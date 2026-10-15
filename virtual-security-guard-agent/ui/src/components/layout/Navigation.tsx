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
      {/* 60px + border, level with the app header so one line runs across. */}
      <SidebarHeader className="h-[60px] shrink-0 justify-center border-b px-2 py-0">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              asChild
              className="h-11 gap-2.5 pl-1.5 hover:bg-transparent active:bg-transparent group-data-[collapsible=icon]:!size-8 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:!p-0"
            >
              <NavLink
                to="/argus"
                aria-label="Virtual Security Guard Agent home"
              >
                <VsgMark className="!size-8" />
                <span className="flex min-w-0 flex-col leading-tight group-data-[collapsible=icon]:hidden">
                  <span className="truncate text-base font-semibold">
                    VSG Agent
                  </span>
                  <span className="truncate text-xs text-muted-foreground">
                    Virtual Security Guard
                  </span>
                </span>
              </NavLink>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup className="pt-3">
          <SidebarGroupContent className="flex flex-col gap-2">
            <SidebarMenu>
              {navItems.map((item) => (
                <SidebarMenuItem key={item.url}>
                  <NavLink to={item.url}>
                    {({ isActive }) => (
                      <SidebarMenuButton
                        tooltip={item.title}
                        isActive={isActive}
                        className={cn(
                          "relative",
                          // Selected: brand tint + left bar; hover stays plain grey.
                          isActive &&
                            "bg-brand-accent/10 font-semibold text-foreground before:absolute before:inset-y-0 before:left-0 before:w-[3px] before:bg-brand-accent hover:bg-brand-accent/15 data-[active=true]:bg-brand-accent/10",
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
