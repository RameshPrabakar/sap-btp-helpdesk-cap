// ============================================================
// IT Helpdesk Ticket Management System - Data Model
// ============================================================

namespace helpdesk;

using { cuid, managed, sap.common.CodeList } from '@sap/cds/common';

// ─────────────────────────────────────────────
// ENUMS / CODE LISTS
// ─────────────────────────────────────────────

type TicketStatus  : String(20)  enum {
  Open        = 'OPEN';
  InProgress  = 'IN_PROGRESS';
  OnHold      = 'ON_HOLD';
  Resolved    = 'RESOLVED';
  Closed      = 'CLOSED';
}

type TicketPriority : String(10) enum {
  Low      = 'LOW';
  Medium   = 'MEDIUM';
  High     = 'HIGH';
  Critical = 'CRITICAL';
}

type AgentRole : String(20) enum {
  L1Support  = 'L1_SUPPORT';
  L2Support  = 'L2_SUPPORT';
  L3Support  = 'L3_SUPPORT';
  Manager    = 'MANAGER';
}

// ─────────────────────────────────────────────
// DEPARTMENT
// ─────────────────────────────────────────────

entity Departments : cuid, managed {
  name         : String(100) not null;
  description  : String(255);
  employees    : Association to many Employees on employees.department = $self;
  tickets      : Association to many Tickets on tickets.department = $self;
}

// ─────────────────────────────────────────────
// EMPLOYEES (Ticket Reporters)
// ─────────────────────────────────────────────

entity Employees : cuid, managed {
  name         : String(100) not null;
  email        : String(150) not null;
  phone        : String(20);
  department   : Association to Departments;
  tickets      : Association to many Tickets on tickets.reporter = $self;
}

// ─────────────────────────────────────────────
// AGENTS (IT Support Staff)
// ─────────────────────────────────────────────

entity Agents : cuid, managed {
  name         : String(100) not null;
  email        : String(150) not null;
  phone        : String(20);
  role         : AgentRole default 'L1_SUPPORT';
  isActive     : Boolean default true;
  tickets      : Association to many Tickets on tickets.assignedTo = $self;
}

// ─────────────────────────────────────────────
// CATEGORIES
// ─────────────────────────────────────────────

entity Categories : cuid {
  name         : String(100) not null;
  description  : String(255);
  slaHours     : Integer default 24;  // SLA resolution time in hours
  tickets      : Association to many Tickets on tickets.category = $self;
}

// ─────────────────────────────────────────────
// TICKETS (Core Entity)
// ─────────────────────────────────────────────

entity Tickets : cuid, managed {
  ticketNumber   : String(20);                         // Auto-generated e.g. TKT-2024-0001
  title          : String(200) not null;
  description    : String(2000) not null;
  status         : TicketStatus default 'OPEN';
  priority       : TicketPriority default 'MEDIUM';
  category       : Association to Categories;
  department     : Association to Departments;
  reporter       : Association to Employees;
  assignedTo     : Association to Agents;
  resolvedAt     : Timestamp;
  closedAt       : Timestamp;
  dueDate        : Timestamp;
  resolutionNote : String(2000);
  comments       : Composition of many Comments on comments.ticket = $self;
  attachments    : Composition of many Attachments on attachments.ticket = $self;
  isOverdue      : Boolean default false;
}

// ─────────────────────────────────────────────
// COMMENTS
// ─────────────────────────────────────────────

entity Comments : cuid, managed {
  ticket       : Association to Tickets;
  content      : String(2000) not null;
  isInternal   : Boolean default false;   // Internal note vs public comment
  authorName   : String(100) not null;
  authorEmail  : String(150);
}

// ─────────────────────────────────────────────
// ATTACHMENTS
// ─────────────────────────────────────────────

entity Attachments : cuid, managed {
  ticket       : Association to Tickets;
  fileName     : String(255) not null;
  fileSize     : Integer;
  mimeType     : String(100);
  url          : String(500);
}

// ─────────────────────────────────────────────
// AUDIT LOG (Track all status changes)
// ─────────────────────────────────────────────

entity AuditLogs : cuid {
  ticket       : Association to Tickets;
  action       : String(100) not null;    // e.g. "Status Changed", "Agent Assigned"
  oldValue     : String(500);
  newValue     : String(500);
  performedBy  : String(100) not null;
  performedAt  : Timestamp @cds.on.insert : $now;
  remarks      : String(500);
}
