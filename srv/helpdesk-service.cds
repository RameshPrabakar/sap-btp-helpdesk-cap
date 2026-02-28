// ============================================================
// IT Helpdesk Service Definition
// ============================================================

using { helpdesk } from '../db/schema';

// ─────────────────────────────────────────────
// PUBLIC HELPDESK SERVICE (Employees + Agents)
// ─────────────────────────────────────────────

service HelpdeskService @(path: '/helpdesk') {

  // === READ-ONLY LOOKUPS ===
  @readonly entity Categories   as projection on helpdesk.Categories;
  @readonly entity Departments  as projection on helpdesk.Departments;
  @readonly entity Employees    as projection on helpdesk.Employees;
  @readonly entity Agents       as projection on helpdesk.Agents
    where isActive = true;

  // === TICKETS (Full CRUD) ===
  entity Tickets as projection on helpdesk.Tickets {
    *,
    category.name         as categoryName,
    department.name       as departmentName,
    reporter.name         as reporterName,
    reporter.email        as reporterEmail,
    assignedTo.name       as agentName,
    assignedTo.email      as agentEmail,
    comments,
    attachments
  };

  // === COMMENTS ===
  entity Comments as projection on helpdesk.Comments;

  // === ATTACHMENTS ===
  entity Attachments as projection on helpdesk.Attachments;

  // === AUDIT LOGS (Read Only) ===
  @readonly entity AuditLogs as projection on helpdesk.AuditLogs;

  // ─────────────────────────────────────────────
  // CUSTOM ACTIONS
  // ─────────────────────────────────────────────

  // Assign agent to a ticket
  action assignAgent(
    ticketID  : UUID,
    agentID   : UUID,
    remarks   : String
  ) returns Tickets;

  // Change ticket priority
  action changePriority(
    ticketID  : UUID,
    priority  : String,
    reason    : String
  ) returns Tickets;

  // Mark ticket as resolved
  action resolveTicket(
    ticketID       : UUID,
    resolutionNote : String,
    agentName      : String
  ) returns Tickets;

  // Close a resolved ticket
  action closeTicket(
    ticketID  : UUID,
    agentName : String
  ) returns Tickets;

  // Escalate ticket to higher support level
  action escalateTicket(
    ticketID   : UUID,
    reason     : String,
    agentName  : String
  ) returns Tickets;

  // Reopen a closed/resolved ticket
  action reopenTicket(
    ticketID   : UUID,
    reason     : String,
    agentName  : String
  ) returns Tickets;

  // ─────────────────────────────────────────────
  // CUSTOM FUNCTIONS (Read-Only Queries)
  // ─────────────────────────────────────────────

  // Get dashboard statistics
  function getDashboardStats() returns {
    totalTickets    : Integer;
    openTickets     : Integer;
    inProgressTickets : Integer;
    resolvedToday   : Integer;
    overdueTickets  : Integer;
    criticalTickets : Integer;
  };

  // Get tickets assigned to a specific agent
  function getAgentTickets(agentID : UUID) returns array of Tickets;

  // Get overdue tickets
  function getOverdueTickets() returns array of Tickets;
}

// ─────────────────────────────────────────────
// ADMIN SERVICE (Management Operations)
// ─────────────────────────────────────────────

service AdminService @(path: '/admin') {

  entity Departments  as projection on helpdesk.Departments;
  entity Employees    as projection on helpdesk.Employees;
  entity Agents       as projection on helpdesk.Agents;
  entity Categories   as projection on helpdesk.Categories;

  @readonly entity AllTickets   as projection on helpdesk.Tickets;
  @readonly entity AllAuditLogs as projection on helpdesk.AuditLogs;
}
