const { ApolloServer, gql } = require("apollo-server-micro");

const typeDefs = gql`
  type Query {
    hello: String
  }
`;

const resolvers = {
  Query: {
    hello: () => "Hello, World!"
  }
};

const apolloServer = new ApolloServer({
  typeDefs,
  resolvers,
  introspection: true,
  playground: true
});

module.exports = apolloServer.createHandler();
