const { ApolloServer, gql } = require("apollo-server-micro");
const { PubSub } = require("apollo-server");
const { prisma } = require("./prisma/generated/prisma-client");

const pubsub = new PubSub();

const typeDefs = gql`
  type User {
    id: ID!
    name: String!
    posts: [Post!]!
  }

  type Post {
    id: ID!
    description: String!
    user: User!
  }

  type Subscription {
    postCreated: Post
  }

  type Query {
    posts: [Post!]!
    post(postId: ID!): Post
    users: [User!]!
    user(userId: ID!): User
  }

  type Mutation {
    createPost(userId: ID!, description: String!): Post!
    updatePost(postId: ID!, description: String!): Post!
    deletePost(postId: ID!): Post!
    signUp(name: String!): User
  }
`;

const POST_CREATED = "POST_CREATED";

const resolvers = {
  Subscription: {
    postCreated: {
      subscribe: () => pubsub.asyncIterator([POST_CREATED])
    }
  },
  Query: {
    posts: async (root, args, context) => {
      return await context.prisma.posts();
    },
    post: async (root, args, context) => {
      return await context.prisma.post({ id: args.postId });
    },
    users: async (root, args, context) => {
      return await context.prisma.users();
    }
  },
  Mutation: {
    createPost: (root, args, context) => {
      const newPost = {
        description: args.description,
        user: {
          connect: { id: args.userId }
        }
      };

      pubsub.publish(POST_CREATED, { newPost });
      return context.prisma.createPost(newPost);
    },
    updatePost: (root, args, context) => {
      return context.prisma.updatePost({
        where: { id: args.postId },
        data: { description: args.description }
      });
    },
    deletePost: (root, args, context) => {
      return context.prisma.deletePost({ id: args.postId });
    },
    signUp: async (root, args, context) =>
      await context.prisma.createUser({ name: args.name })
  },
  User: {
    posts: (root, args, context) => {
      return context.prisma
        .user({
          id: root.id
        })
        .posts();
    }
  },
  Post: {
    user: (root, args, context) => {
      return context.prisma
        .post({
          id: root.id
        })
        .user();
    }
  }
};

const apolloServer = new ApolloServer({
  typeDefs,
  resolvers,
  introspection: true,
  playground: true,
  context: async ({ req, connection }) => {
    if (connection) {
      return connection.context;
    } else {
      const token = req.headers.authorization || "";
      return { prisma, token };
    }
  }
});

module.exports = apolloServer.createHandler();
