// const micro = require("micro");
const cors = require("micro-cors")();
const { ApolloServer, gql } = require("apollo-server-micro");
const { PubSub } = require("apollo-server");
// const { ApolloServer, gql, PubSub } = require("apollo-server");
const { prisma } = require("./prisma/generated/prisma-client");
const _ = require("lodash");
const { hash, compare } = require("bcryptjs");
const jwt = require("jsonwebtoken");
const AWS = require("aws-sdk");

const s3 = new AWS.S3({
  apiVersion: "2006-03-01",
  endpoint: "s3.cn-north-1.jdcloud-oss.com",
  accessKeyId: "A7487560A7B27AE4A5744D14C1DC152C",
  secretAccessKey: "6466ECB2C88AF6A5FECA76D880EDC64F",
  s3ForcePathStyle: true,
  signatureVersion: "v4"
});

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
    file: File
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
    category: Category!
    files: [File!]!
    likes: [Like!]!
  }

  type Product implements Feed {
    id: ID!
    createdAt: Date!
    updatedAt: Date!
    productDescription: String!
    price: Float!
    phoneNumber: String!
    user: User!
    files: [File!]!
    productCategory: ProductCategory!
  }

  type Category {
    id: ID!
    name: String!
    posts: [Post!]!
  }

  type ProductCategory {
    id: ID!
    name: String!
    posts: [Post!]!
  }

  type File {
    id: ID!
    filename: String
    mimetype: String
    encoding: String
    url: String
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
    categories: [Category!]!
    productCategories: [ProductCategory!]!
    likes: [Like!]!
  }

  type Mutation {
    createPost(description: String!, categoryId: ID!, files: [Upload!]!): Post!
    updatePost(postId: ID!, description: String!): Post!
    deletePost(postId: ID!): Post!
    likePost(postId: ID!): Like!
    createProduct(
      productDescription: String!
      price: Float!
      phoneNumber: String!
      categoryId: ID!
      files: [Upload!]!
    ): Product!
    updateProduct(
      productId: ID!
      productDescription: String
      price: Float!
      phoneNumber: String
    ): Product!
    deleteProduct(productId: ID!): Product!
    createCategory(name: String!): Category!
    createProductCategory(name: String!): ProductCategory!
    signUp(name: String!, email: String!, password: String!): User
    signIn(email: String!, password: String!): LoginResponse
  }
`;

const POST_CREATED = "POST_CREATED";

const processUpload = async upload => {
  let { filename, mimetype, encoding, createReadStream } = await upload;
  let stream = createReadStream();

  const response = await s3
    .upload({
      Bucket: "ortoo",
      Key: filename,
      Body: stream,
      ACL: "public-read",
      ContentType: mimetype
    })
    .promise();

  const url = response.Location;

  const file = {
    filename,
    mimetype,
    encoding,
    url
  };

  return file;
};

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
      return await context.prisma.products({
        orderBy: "createdAt_DESC"
      });
    },
    product: async (root, args, context) => {
      return await context.prisma.product({ id: args.productId });
    },
    users: async (root, args, context) => {
      return await context.prisma.users();
    },
    me: async (root, args, context) => {
      const userId = context.user && context.user.id;
      return await context.prisma.user({ id: userId });
    },
    categories: async (root, args, context) => {
      return await context.prisma.categories();
    },
    productCategories: async (root, args, context) => {
      return await context.prisma.productCategories();
    },
    likes: async (root, args, context) => {
      return await context.prisma.post({ id: root.id }).likes();
    }
  },
  Mutation: {
    createPost: async (root, args, context) => {
      const newPost = {
        description: args.description,
        user: {
          connect: { id: context.user.id }
        },
        category: {
          connect: { id: args.categoryId }
        },
        files: {
          create: await Promise.all(
            args.files.map(async file => processUpload(file))
          )
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
    likePost: (root, args, context) => {
      return context.prisma.createLike({
        post: {
          connect: { id: args.postId }
        },
        user: {
          connect: { id: context.user.id }
        }
      });
    },
    createProduct: async (root, args, context) => {
      const newProduct = {
        productDescription: args.productDescription,
        price: args.price,
        phoneNumber: args.phoneNumber,
        user: {
          connect: { id: context.user.id }
        },
        productCategory: {
          connect: { id: args.categoryId }
        },
        files: {
          create: await Promise.all(
            args.files.map(async file => processUpload(file))
          )
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
    createCategory: (root, args, context) => {
      return context.prisma.createCategory({
        name: args.name
      });
    },
    createProductCategory: (root, args, context) => {
      return context.prisma.createProductCategory({
        name: args.name
      });
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
        token: jwt.sign({ id: user.id }, JWT_SECRET, { expiresIn: "30d" }),
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
    },
    category: async (root, args, context) => {
      return await context.prisma
        .post({
          id: root.id
        })
        .category();
    },
    files: (root, args, context) => {
      return context.prisma
        .post({
          id: root.id
        })
        .files();
    },
    likes: async (root, args, context) => {
      return await context.prisma
        .post({
          id: root.id
        })
        .likes();
    }
  },
  Product: {
    user: (root, args, context) => {
      return context.prisma
        .product({
          id: root.id
        })
        .user();
    },
    productCategory: async (root, args, context) => {
      return await context.prisma
        .product({
          id: root.id
        })
        .productCategory();
    },
    files: (root, args, context) => {
      return context.prisma
        .product({
          id: root.id
        })
        .files();
    }
  },
  Like: {
    post: async (root, args, context) => {
      return context.prisma
        .like({
          id: root.id
        })
        .post();
    },
    user: async (root, args, context) => {
      return await context.prisma
        .like({
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

module.exports = cors((req, res) => {
  if (req.method === "OPTIONS") {
    res.end();
    return;
  }
  return apolloServer.createHandler()(req, res);
});

// const optionsHandler = (req, res) => {
//   if (req.method === "OPTIONS") {
//     res.end();
//     return;
//   }
//   return apolloServer.createHandler()(req, res);
// };

// const microserver = micro(cors()(optionsHandler));
// module.exports = microserver;

// apolloServer.listen().then(({ url }) => {
//   console.log(`🚀  Server ready at ${url}`);
// });
