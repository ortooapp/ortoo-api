const cors = require("micro-cors")();
const { ApolloServer, gql } = require("apollo-server-micro");
const { PubSub } = require("apollo-server");
const { prisma } = require("./prisma/generated/prisma-client");
const _ = require("lodash");
const { hash, compare } = require("bcryptjs");
const jwt = require("jsonwebtoken");

const JWT_SECRET = "secret113";

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
    email: String!
    password: String!
    posts: [Post!]!
    products: [Product!]!
  }

  type LoginResponse {
    token: String!
    user: User!
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

  type Like {
    id: ID!
    createdAt: Date!
    updatedAt: Date!
    post: Post!
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
    me: User
    products: [Product!]!
    product(productId: ID!): Product
  }

  type Mutation {
    createPost(description: String!): Post!
    updatePost(postId: ID!, description: String!): Post!
    deletePost(postId: ID!): Post!
    createProduct(
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
    signUp(name: String!, email: String!, password: String!): User
    signIn(email: String!, password: String!): LoginResponse
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
    },
    me: async (root, args, context) => {
      return await context.prisma.user({ id: context.user.id });
    }
  },
  Mutation: {
    createPost: (root, args, context) => {
      const newPost = {
        description: args.description,
        user: {
          connect: { id: context.user.id }
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
          connect: { id: context.user.id }
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
    signUp: async (root, args, context) => {
      return await context.prisma.createUser({
        name: args.name,
        email: args.email,
        password: await hash(args.password, 10)
      });
    },
    signIn: async (root, { email, password }, context) => {
      const user = await context.prisma.user({ email });
      if (!user) {
        throw new Error(`User not found for email: ${email}`);
      }
      const passwordValid = await compare(password, user.password);
      if (!passwordValid) {
        throw new Error("Invalid password");
      }

      return {
        token: jwt.sign({ id: user.id }, JWT_SECRET, { expiresIn: "1h" }),
        user
      };
    }
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

const getUser = token => {
  try {
    if (token) {
      return jwt.verify(token, JWT_SECRET);
    }
    return null;
  } catch (err) {
    return null;
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
      const tokenWithBearer = req.headers.authorization || "";
      const token = tokenWithBearer.split(" ")[1];

      const user = getUser(token);

      return { prisma, user };
    }
  }
});

module.exports = cors(apolloServer.createHandler());
