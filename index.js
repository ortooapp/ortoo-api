const { ApolloServer, gql } = require("apollo-server-micro");
const { PubSub } = require("apollo-server");
const { prisma } = require("./prisma/generated/prisma-client");
const _ = require("lodash");

const pubsub = new PubSub();

const typeDefs = gql`
  scalar Date

  interface Feed {
    id: ID!
    createdAt: Date!
    updatedAt: Date!
  }

  type User {
    id: ID!
    name: String!
    posts: [Post!]!
    products: [Product!]!
  }

  type Post implements Feed {
    id: ID!
    createdAt: Date!
    updatedAt: Date!
    description: String!
    user: User!
  }

  type Product implements Feed {
    id: ID!
    createdAt: Date!
    updatedAt: Date!
    productDescription: String!
    price: Int
    phoneNumber: String!
    user: User!
  }

  type Subscription {
    postCreated: Post
  }

  type Query {
    feed: [Feed!]!
    posts: [Post!]!
    post(postId: ID!): Post
    users: [User!]!
    user(userId: ID!): User
    products: [Product!]!
    product(productId: ID!): Product
  }

  type Mutation {
    createPost(userId: ID!, description: String!): Post!
    updatePost(postId: ID!, description: String!): Post!
    deletePost(postId: ID!): Post!
    createProduct(
      userId: ID!
      productDescription: String!
      price: Int
      phoneNumber: String!
    ): Product!
    updateProduct(
      productId: ID!
      productDescription: String
      price: Int
      phoneNumber: String
    ): Product!
    deleteProduct(productId: ID!): Product!
    signUp(name: String!): User
  }
`;

const POST_CREATED = "POST_CREATED";

const resolvers = {
  Feed: {
    __resolveType(obj) {
      if (obj.description) {
        return "Post";
      }

      if (obj.productDescription) {
        return "Product";
      }

      return null;
    }
  },
  Subscription: {
    postCreated: {
      subscribe: () => pubsub.asyncIterator([POST_CREATED])
    }
  },
  Query: {
    feed: async (root, args, { prisma }) => {
      return await Promise.all([prisma.posts(), prisma.products()]).then(
        values => {
          values = [].concat.apply([], values);
          return _.sortBy(values, ["createdAt"]).reverse();
        }
      );
    },
    posts: async (root, args, context) => {
      return await context.prisma.posts();
    },
    post: async (root, args, context) => {
      return await context.prisma.post({ id: args.postId });
    },
    products: async (root, args, context) => {
      return await context.prisma.products();
    },
    product: async (root, args, context) => {
      return await context.prisma.product({ id: args.productId });
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
    createProduct: (root, args, context) => {
      const newProduct = {
        productDescription: args.productDescription,
        price: args.price,
        phoneNumber: args.phoneNumber,
        user: {
          connect: { id: args.userId }
        }
      };
      return context.prisma.createProduct(newProduct);
    },
    updateProduct: (root, args, context) => {
      return context.prisma.updateProduct({
        where: { id: args.productId },
        data: {
          productDescription: args.productDescription,
          price: args.price,
          phoneNumber: args.phoneNumber
        }
      });
    },
    deleteProduct: (root, args, context) => {
      return context.prisma.deleteProduct({ id: args.productId });
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
    },
    products: (root, args, context) => {
      return context.prisma
        .user({
          id: root.id
        })
        .products();
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
  },
  Product: {
    user: (root, args, context) => {
      return context.prisma
        .product({
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
