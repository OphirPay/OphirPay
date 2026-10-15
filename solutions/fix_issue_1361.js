// Solution for issue #1361
// Generated automatically by Baobot

const { ApolloServer, gql } = require('apollo-server');
const { DateTime } = require('luxon');

const typeDefs = gql`
  type AuditLog {
    id: ID!
    userId: ID!
    eventType: String!
    timestamp: String!
    message: String!
  }

  type Query {
    auditLogs(limit: Int, cursor: String): [AuditLog]!
    auditLog(id: ID): AuditLog
  }

  type Mutation {
    createAuditLog(userId: ID!, eventType: String!, message: String!, timestamp: String): AuditLog!
  }
`;

const resolvers = {
  Query: {
    auditLogs: async (_, { limit, cursor }, { dataSources }) => {
      const { AuditLogCollection } = dataSources;
      let auditLogs = await AuditLogCollection.find().sort({ timestamp: -1 }).toArray();
      
      if (cursor) {
        const cursorTimestamp = DateTime.fromISO(cursor).toISO();
        auditLogs = auditLogs.filter(log => log.timestamp > cursorTimestamp);
      }

      if (limit) {
        auditLogs = auditLogs.slice(0, limit);
      }

      return auditLogs;
    },
    auditLog: async (_, { id }, { dataSources }) => {
      const { AuditLogCollection } = dataSources;
      const log = await AuditLogCollection.findOne({ id });
      return log;
    },
  },
  Mutation: {
    createAuditLog: async (_, { userId, eventType, message, timestamp }, { dataSources }) => {
      const { AuditLogCollection } = dataSources;
      const newLog = new AuditLogCollection({
        id: new Date().toISOString(),
        userId,
        eventType,
        timestamp: DateTime.fromISO(timestamp).toISO(),
        message
      });
      const savedLog = await newLog.save();
      return savedLog;
    },
  },
};

const server = new ApolloServer({ typeDefs, resolvers });

server.listen().then(({ url }) => {
  console.log(`🚀 Server ready at ${url}`);
});


This code snippet sets up a basic Apollo Server with GraphQL to handle CRUD operations for audit logs. It includes cursor-based pagination and sorting for the `/api/audit-log` route. The `AuditLogCollection` is a placeholder for your actual data source. Replace this with your actual database connection or mock data source.