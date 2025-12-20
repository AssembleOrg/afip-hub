module.exports = function (options, webpack) {
  const lazyImports = [
    '@nestjs/microservices/microservices-module',
    '@nestjs/websockets/socket-module',
  ];

  return {
    ...options,
    externals: [
      ...(options.externals || []),
      'bcrypt',
      'pg',
      'pg-native',
      'soap',
      '@prisma/adapter-pg',
      '@prisma/client',
      '@prisma/client/runtime',
      /^@prisma\/.*/,
      /^\.prisma\/.*/,
    ],
    output: {
      ...options.output,
      libraryTarget: 'commonjs2',
    },
    watchOptions: {
      ignored: [
        '**/node_modules/**',
        '**/dist/**',
        '**/.git/**',
        '**/tmp/**',
        '**/coverage/**',
        '**/.pnpm/**',
      ],
      aggregateTimeout: 300,
      poll: false,
    },
    plugins: [
      ...options.plugins,
      new webpack.IgnorePlugin({
        checkResource(resource) {
          if (lazyImports.includes(resource)) {
            try {
              require.resolve(resource);
            } catch (err) {
              return true;
            }
          }
          return false;
        },
      }),
    ],
    resolve: {
      ...options.resolve,
      extensions: ['.ts', '.js', '.json'],
      alias: {
        ...options.resolve?.alias,
      },
      extensionAlias: {
        '.js': ['.ts', '.js'],
      },
    },
  };
};
