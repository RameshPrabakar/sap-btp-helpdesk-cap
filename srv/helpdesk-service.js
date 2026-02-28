// ============================================================
// IT Helpdesk Service - Business Logic (Node.js Handler)
// ============================================================

const cds = require('@sap/cds');

module.exports = class HelpdeskService extends cds.ApplicationService {

  async init() {

    const { Tickets, Agents, AuditLogs, Comments } = this.entities;

    // ─────────────────────────────────────────────
    // BEFORE HOOKS
    // ─────────────────────────────────────────────

    /**
     * Auto-generate ticket number before create
     * Format: TKT-2024-00001
     */
    this.before('CREATE', 'Tickets', async (req) => {
      const year = new Date().getFullYear();
      const count = await SELECT.one`count(*) as total`.from(Tickets);
      const seq = String((count?.total || 0) + 1).padStart(5, '0');
      req.data.ticketNumber = `TKT-${year}-${seq}`;

      // Calculate due date based on category SLA
      if (req.data.category_ID) {
        const { Categories } = cds.entities('helpdesk');
        const category = await SELECT.one.from(Categories).where({ ID: req.data.category_ID });
        if (category?.slaHours) {
          const due = new Date();
          due.setHours(due.getHours() + category.slaHours);
          req.data.dueDate = due.toISOString();
        }
      }

      // Default status
      req.data.status = 'OPEN';
    });

    /**
     * Validate ticket before creation
     */
    this.before('CREATE', 'Tickets', (req) => {
      const { title, description, reporter_ID } = req.data;

      if (!title || title.trim().length < 5) {
        req.error(400, 'Ticket title must be at least 5 characters long');
      }
      if (!description || description.trim().length < 10) {
        req.error(400, 'Ticket description must be at least 10 characters long');
      }
      if (!reporter_ID) {
        req.error(400, 'Reporter is required to create a ticket');
      }
    });

    /**
     * Prevent editing of closed tickets
     */
    this.before('UPDATE', 'Tickets', async (req) => {
      const ticket = await SELECT.one.from(Tickets).where({ ID: req.data.ID });
      if (ticket?.status === 'CLOSED') {
        req.error(409, `Ticket ${ticket.ticketNumber} is closed and cannot be modified`);
      }
    });

    // ─────────────────────────────────────────────
    // AFTER HOOKS
    // ─────────────────────────────────────────────

    /**
     * After ticket is created — log it
     */
    this.after('CREATE', 'Tickets', async (ticket) => {
      await this._logAudit(ticket.ID, 'Ticket Created', null, ticket.status, 'System');
    });

    /**
     * Check for overdue tickets on every READ
     */
    this.after('READ', 'Tickets', (tickets) => {
      const now = new Date();
      const list = Array.isArray(tickets) ? tickets : [tickets];
      list.forEach(ticket => {
        if (ticket.dueDate && new Date(ticket.dueDate) < now
          && !['RESOLVED', 'CLOSED'].includes(ticket.status)) {
          ticket.isOverdue = true;
        }
      });
    });

    // ─────────────────────────────────────────────
    // CUSTOM ACTIONS
    // ─────────────────────────────────────────────

    /**
     * ACTION: Assign an agent to a ticket
     */
    this.on('assignAgent', async (req) => {
      const { ticketID, agentID, remarks } = req.data;

      const ticket = await SELECT.one.from(Tickets).where({ ID: ticketID });
      if (!ticket) return req.error(404, `Ticket not found: ${ticketID}`);
      if (ticket.status === 'CLOSED') return req.error(409, 'Cannot assign agent to a closed ticket');

      const agent = await SELECT.one.from(Agents).where({ ID: agentID, isActive: true });
      if (!agent) return req.error(404, `Active agent not found: ${agentID}`);

      const oldAgent = ticket.assignedTo_ID;

      await UPDATE(Tickets)
        .set({ assignedTo_ID: agentID, status: 'IN_PROGRESS' })
        .where({ ID: ticketID });

      await this._logAudit(
        ticketID,
        'Agent Assigned',
        oldAgent ? `Agent: ${oldAgent}` : 'Unassigned',
        `Agent: ${agent.name}`,
        remarks || 'System'
      );

      return await SELECT.one.from(Tickets).where({ ID: ticketID });
    });

    /**
     * ACTION: Change ticket priority
     */
    this.on('changePriority', async (req) => {
      const { ticketID, priority, reason } = req.data;
      const validPriorities = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];

      if (!validPriorities.includes(priority)) {
        return req.error(400, `Invalid priority. Must be one of: ${validPriorities.join(', ')}`);
      }

      const ticket = await SELECT.one.from(Tickets).where({ ID: ticketID });
      if (!ticket) return req.error(404, `Ticket not found: ${ticketID}`);

      const oldPriority = ticket.priority;
      await UPDATE(Tickets).set({ priority }).where({ ID: ticketID });

      await this._logAudit(ticketID, 'Priority Changed', oldPriority, priority, reason || 'System');

      return await SELECT.one.from(Tickets).where({ ID: ticketID });
    });

    /**
     * ACTION: Resolve a ticket
     */
    this.on('resolveTicket', async (req) => {
      const { ticketID, resolutionNote, agentName } = req.data;

      const ticket = await SELECT.one.from(Tickets).where({ ID: ticketID });
      if (!ticket) return req.error(404, `Ticket not found: ${ticketID}`);

      if (['RESOLVED', 'CLOSED'].includes(ticket.status)) {
        return req.error(409, `Ticket is already ${ticket.status.toLowerCase()}`);
      }
      if (!resolutionNote || resolutionNote.trim().length < 10) {
        return req.error(400, 'Resolution note must be at least 10 characters long');
      }

      const resolvedAt = new Date().toISOString();
      await UPDATE(Tickets)
        .set({ status: 'RESOLVED', resolvedAt, resolutionNote })
        .where({ ID: ticketID });

      // Add system comment
      await INSERT.into(Comments).entries({
        ticket_ID   : ticketID,
        content     : `✅ Ticket resolved. Note: ${resolutionNote}`,
        isInternal  : false,
        authorName  : agentName || 'Support Agent',
        authorEmail : ''
      });

      await this._logAudit(ticketID, 'Ticket Resolved', ticket.status, 'RESOLVED', agentName || 'System');

      return await SELECT.one.from(Tickets).where({ ID: ticketID });
    });

    /**
     * ACTION: Close a ticket
     */
    this.on('closeTicket', async (req) => {
      const { ticketID, agentName } = req.data;

      const ticket = await SELECT.one.from(Tickets).where({ ID: ticketID });
      if (!ticket) return req.error(404, `Ticket not found: ${ticketID}`);

      if (ticket.status === 'CLOSED') {
        return req.error(409, 'Ticket is already closed');
      }
      if (ticket.status !== 'RESOLVED') {
        return req.error(409, 'Only resolved tickets can be closed. Please resolve the ticket first');
      }

      const closedAt = new Date().toISOString();
      await UPDATE(Tickets).set({ status: 'CLOSED', closedAt }).where({ ID: ticketID });

      await this._logAudit(ticketID, 'Ticket Closed', 'RESOLVED', 'CLOSED', agentName || 'System');

      return await SELECT.one.from(Tickets).where({ ID: ticketID });
    });

    /**
     * ACTION: Escalate a ticket
     */
    this.on('escalateTicket', async (req) => {
      const { ticketID, reason, agentName } = req.data;

      const ticket = await SELECT.one.from(Tickets).where({ ID: ticketID });
      if (!ticket) return req.error(404, `Ticket not found: ${ticketID}`);

      if (['RESOLVED', 'CLOSED'].includes(ticket.status)) {
        return req.error(409, 'Cannot escalate a resolved or closed ticket');
      }

      const oldPriority = ticket.priority;
      const newPriority = this._escalatePriority(oldPriority);

      await UPDATE(Tickets).set({ priority: newPriority, status: 'IN_PROGRESS' }).where({ ID: ticketID });

      await INSERT.into(Comments).entries({
        ticket_ID   : ticketID,
        content     : `⚠️ Ticket escalated. Reason: ${reason || 'No reason provided'}`,
        isInternal  : true,
        authorName  : agentName || 'System',
        authorEmail : ''
      });

      await this._logAudit(
        ticketID, 'Ticket Escalated',
        `Priority: ${oldPriority}`,
        `Priority: ${newPriority}`,
        agentName || 'System'
      );

      return await SELECT.one.from(Tickets).where({ ID: ticketID });
    });

    /**
     * ACTION: Reopen a closed/resolved ticket
     */
    this.on('reopenTicket', async (req) => {
      const { ticketID, reason, agentName } = req.data;

      const ticket = await SELECT.one.from(Tickets).where({ ID: ticketID });
      if (!ticket) return req.error(404, `Ticket not found: ${ticketID}`);

      if (!['RESOLVED', 'CLOSED'].includes(ticket.status)) {
        return req.error(409, 'Only resolved or closed tickets can be reopened');
      }
      if (!reason || reason.trim().length < 5) {
        return req.error(400, 'A reason must be provided to reopen a ticket');
      }

      await UPDATE(Tickets)
        .set({ status: 'OPEN', resolvedAt: null, closedAt: null, resolutionNote: null })
        .where({ ID: ticketID });

      await INSERT.into(Comments).entries({
        ticket_ID   : ticketID,
        content     : `🔄 Ticket reopened. Reason: ${reason}`,
        isInternal  : false,
        authorName  : agentName || 'System',
        authorEmail : ''
      });

      await this._logAudit(ticketID, 'Ticket Reopened', ticket.status, 'OPEN', agentName || 'System');

      return await SELECT.one.from(Tickets).where({ ID: ticketID });
    });

    // ─────────────────────────────────────────────
    // CUSTOM FUNCTIONS
    // ─────────────────────────────────────────────

    /**
     * FUNCTION: Dashboard statistics
     */
    this.on('getDashboardStats', async () => {
      const now = new Date();
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();

      const [total, open, inProgress, resolvedToday, critical] = await Promise.all([
        SELECT.one`count(*) as cnt`.from(Tickets),
        SELECT.one`count(*) as cnt`.from(Tickets).where({ status: 'OPEN' }),
        SELECT.one`count(*) as cnt`.from(Tickets).where({ status: 'IN_PROGRESS' }),
        SELECT.one`count(*) as cnt`.from(Tickets).where(`status = 'RESOLVED' and resolvedAt >= '${todayStart}'`),
        SELECT.one`count(*) as cnt`.from(Tickets).where({ priority: 'CRITICAL', status: { '!=': 'CLOSED' } })
      ]);

      const overdueResult = await SELECT`ID`.from(Tickets)
        .where(`dueDate < '${now.toISOString()}' and status not in ('RESOLVED','CLOSED')`);

      return {
        totalTickets      : total?.cnt || 0,
        openTickets       : open?.cnt || 0,
        inProgressTickets : inProgress?.cnt || 0,
        resolvedToday     : resolvedToday?.cnt || 0,
        overdueTickets    : overdueResult?.length || 0,
        criticalTickets   : critical?.cnt || 0
      };
    });

    /**
     * FUNCTION: Get tickets assigned to an agent
     */
    this.on('getAgentTickets', async (req) => {
      const { agentID } = req.data;
      return await SELECT.from(Tickets)
        .where({ assignedTo_ID: agentID, status: { '!=': 'CLOSED' } })
        .orderBy('priority desc, createdAt asc');
    });

    /**
     * FUNCTION: Get overdue tickets
     */
    this.on('getOverdueTickets', async () => {
      const now = new Date().toISOString();
      return await SELECT.from(Tickets)
        .where(`dueDate < '${now}' and status not in ('RESOLVED','CLOSED')`)
        .orderBy('priority desc');
    });

    await super.init();
  }

  // ─────────────────────────────────────────────
  // PRIVATE HELPER METHODS
  // ─────────────────────────────────────────────

  /**
   * Write an audit log entry
   */
  async _logAudit(ticketID, action, oldValue, newValue, performedBy) {
    const { AuditLogs } = this.entities;
    await INSERT.into(AuditLogs).entries({
      ticket_ID   : ticketID,
      action,
      oldValue    : oldValue ? String(oldValue) : null,
      newValue    : newValue ? String(newValue) : null,
      performedBy : performedBy || 'System',
      performedAt : new Date().toISOString()
    });
  }

  /**
   * Escalate priority by one level
   */
  _escalatePriority(current) {
    const levels = { 'LOW': 'MEDIUM', 'MEDIUM': 'HIGH', 'HIGH': 'CRITICAL', 'CRITICAL': 'CRITICAL' };
    return levels[current] || 'HIGH';
  }
};
