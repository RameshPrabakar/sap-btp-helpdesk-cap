// ============================================================
// IT Helpdesk - Test Suite
// ============================================================

const cds = require('@sap/cds');
const { expect } = require('@jest/globals');

describe('Helpdesk Service Tests', () => {
  let srv;

  // Start test server before all tests
  beforeAll(async () => {
    srv = await cds.test(__dirname + '/..').in(__dirname + '/..');
  });

  // ─────────────────────────────────────────────
  // TICKET CREATION TESTS
  // ─────────────────────────────────────────────

  describe('Ticket Creation', () => {

    it('should create a new ticket with auto-generated ticket number', async () => {
      const response = await srv.post('/helpdesk/Tickets').send({
        title        : 'Test Ticket - Software Issue',
        description  : 'This is a test ticket description with enough detail',
        priority     : 'MEDIUM',
        category_ID  : 'cat-0002',
        department_ID: 'dept-0001',
        reporter_ID  : 'emp-0001'
      });

      expect(response.status).toBe(201);
      expect(response.data.ticketNumber).toMatch(/^TKT-\d{4}-\d{5}$/);
      expect(response.data.status).toBe('OPEN');
    });

    it('should fail when title is too short', async () => {
      const response = await srv.post('/helpdesk/Tickets').send({
        title        : 'Bug',
        description  : 'Short title ticket',
        reporter_ID  : 'emp-0001'
      });
      expect(response.status).toBe(400);
    });

    it('should fail when reporter is missing', async () => {
      const response = await srv.post('/helpdesk/Tickets').send({
        title        : 'Valid Title Ticket',
        description  : 'This is a valid description for the test'
      });
      expect(response.status).toBe(400);
    });
  });

  // ─────────────────────────────────────────────
  // TICKET READ TESTS
  // ─────────────────────────────────────────────

  describe('Ticket Retrieval', () => {

    it('should return all tickets', async () => {
      const response = await srv.get('/helpdesk/Tickets');
      expect(response.status).toBe(200);
      expect(response.data.value).toBeInstanceOf(Array);
      expect(response.data.value.length).toBeGreaterThan(0);
    });

    it('should return a specific ticket by ID', async () => {
      const response = await srv.get('/helpdesk/Tickets(tkt-0001)');
      expect(response.status).toBe(200);
      expect(response.data.ID).toBe('tkt-0001');
      expect(response.data.ticketNumber).toBe('TKT-2024-00001');
    });

    it('should filter tickets by status', async () => {
      const response = await srv.get("/helpdesk/Tickets?$filter=status eq 'OPEN'");
      expect(response.status).toBe(200);
      response.data.value.forEach(t => expect(t.status).toBe('OPEN'));
    });

    it('should filter tickets by priority', async () => {
      const response = await srv.get("/helpdesk/Tickets?$filter=priority eq 'CRITICAL'");
      expect(response.status).toBe(200);
      response.data.value.forEach(t => expect(t.priority).toBe('CRITICAL'));
    });
  });

  // ─────────────────────────────────────────────
  // AGENT ASSIGN ACTION TESTS
  // ─────────────────────────────────────────────

  describe('Assign Agent Action', () => {

    it('should assign an agent to a ticket', async () => {
      const response = await srv.post('/helpdesk/assignAgent').send({
        ticketID : 'tkt-0001',
        agentID  : 'agt-0001',
        remarks  : 'Assigning L1 support agent'
      });
      expect(response.status).toBe(200);
      expect(response.data.assignedTo_ID).toBe('agt-0001');
      expect(response.data.status).toBe('IN_PROGRESS');
    });

    it('should fail when assigning to non-existent agent', async () => {
      const response = await srv.post('/helpdesk/assignAgent').send({
        ticketID : 'tkt-0001',
        agentID  : 'non-existent-agent'
      });
      expect(response.status).toBe(404);
    });
  });

  // ─────────────────────────────────────────────
  // RESOLVE TICKET TESTS
  // ─────────────────────────────────────────────

  describe('Resolve Ticket Action', () => {

    it('should resolve a ticket with resolution note', async () => {
      const response = await srv.post('/helpdesk/resolveTicket').send({
        ticketID       : 'tkt-0002',
        resolutionNote : 'VPN issue resolved by updating client configuration and resetting user credentials',
        agentName      : 'Mike Chen'
      });
      expect(response.status).toBe(200);
      expect(response.data.status).toBe('RESOLVED');
      expect(response.data.resolvedAt).toBeTruthy();
    });

    it('should fail when resolution note is too short', async () => {
      const response = await srv.post('/helpdesk/resolveTicket').send({
        ticketID       : 'tkt-0004',
        resolutionNote : 'Fixed',
        agentName      : 'Agent'
      });
      expect(response.status).toBe(400);
    });

    it('should fail when trying to resolve an already closed ticket', async () => {
      // First resolve it
      await srv.post('/helpdesk/resolveTicket').send({
        ticketID       : 'tkt-0005',
        resolutionNote : 'Printer driver was reinstalled and print spooler was restarted',
        agentName      : 'Sarah Johnson'
      });
      // Then try to resolve again
      const response = await srv.post('/helpdesk/resolveTicket').send({
        ticketID       : 'tkt-0005',
        resolutionNote : 'Trying to resolve again should fail properly',
        agentName      : 'Sarah Johnson'
      });
      expect(response.status).toBe(409);
    });
  });

  // ─────────────────────────────────────────────
  // CLOSE TICKET TESTS
  // ─────────────────────────────────────────────

  describe('Close Ticket Action', () => {

    it('should close a resolved ticket', async () => {
      // tkt-0003 is already RESOLVED in seed data
      const response = await srv.post('/helpdesk/closeTicket').send({
        ticketID  : 'tkt-0003',
        agentName : 'Emma Wilson'
      });
      expect(response.status).toBe(200);
      expect(response.data.status).toBe('CLOSED');
    });

    it('should not close a ticket that is still OPEN', async () => {
      const response = await srv.post('/helpdesk/closeTicket').send({
        ticketID  : 'tkt-0004',
        agentName : 'Emma Wilson'
      });
      expect(response.status).toBe(409);
    });
  });

  // ─────────────────────────────────────────────
  // ESCALATE TICKET TESTS
  // ─────────────────────────────────────────────

  describe('Escalate Ticket Action', () => {

    it('should escalate a ticket priority', async () => {
      const originalTicket = await srv.get('/helpdesk/Tickets(tkt-0004)');
      const originalPriority = originalTicket.data.priority;

      const response = await srv.post('/helpdesk/escalateTicket').send({
        ticketID  : 'tkt-0004',
        reason    : 'Customer is a key account and needs urgent attention',
        agentName : 'Lisa Patel'
      });
      expect(response.status).toBe(200);

      const priorities = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
      const expectedIndex = Math.min(priorities.indexOf(originalPriority) + 1, 3);
      expect(response.data.priority).toBe(priorities[expectedIndex]);
    });
  });

  // ─────────────────────────────────────────────
  // DASHBOARD STATS TESTS
  // ─────────────────────────────────────────────

  describe('Dashboard Statistics', () => {

    it('should return dashboard statistics', async () => {
      const response = await srv.get('/helpdesk/getDashboardStats()');
      expect(response.status).toBe(200);
      expect(response.data).toHaveProperty('totalTickets');
      expect(response.data).toHaveProperty('openTickets');
      expect(response.data).toHaveProperty('criticalTickets');
      expect(response.data.totalTickets).toBeGreaterThan(0);
    });
  });

  // ─────────────────────────────────────────────
  // COMMENTS TESTS
  // ─────────────────────────────────────────────

  describe('Comments', () => {

    it('should add a comment to a ticket', async () => {
      const response = await srv.post('/helpdesk/Comments').send({
        ticket_ID   : 'tkt-0001',
        content     : 'We have received your ticket and will investigate the screen flickering issue shortly',
        isInternal  : false,
        authorName  : 'John Smith',
        authorEmail : 'john.smith@helpdesk.com'
      });
      expect(response.status).toBe(201);
      expect(response.data.ticket_ID).toBe('tkt-0001');
    });
  });
});
