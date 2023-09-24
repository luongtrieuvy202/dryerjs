import * as graphql from 'graphql';
import { CachedPropertiesByModel, MetadataKey } from '../metadata';
import { Api, Model } from '../type';

export class CreateApi implements Api {
    constructor(private model: Model<any>) {}

    public getEndpoint() {
        return {
            [`create${this.model.name}`]: {
                type: this.model.graphql.output,
                args: { input: { type: new graphql.GraphQLNonNull(this.model.graphql.create) } },
                resolve: async (_parent: any, { input }, context: any) => {
                    await this.validate(input, context);
                    const defaultAppliedInput = await this.setDefault(input, context);
                    const transformedInput = await this.transform(defaultAppliedInput, context);
                    return this.model.db.create(transformedInput);
                },
            },
        };
    }

    private async validate(input: any, context: any) {
        for (const property in CachedPropertiesByModel.getPropertiesByModel(
            this.model.name,
            MetadataKey.Validate,
        ) || {}) {
            if (input[property] === undefined) continue;
            const validateFn = CachedPropertiesByModel.getMetadataValue(
                this.model.name,
                MetadataKey.Validate,
                property,
            );
            if (!validateFn) continue;
            await validateFn(input[property], context, input);
        }
    }

    private async setDefault(input: any, context: any) {
        const properties = {};
        [MetadataKey.DefaultOnCreate, MetadataKey.DefaultOnInput].forEach(metaKey => {
            Object.keys(CachedPropertiesByModel.getPropertiesByModel(this.model.name, metaKey)).forEach(
                (property: string) => {
                    properties[property] = true;
                },
            );
        });

        for (const property in properties) {
            if (input[property] !== null && input[property] !== undefined) continue;
            const defaultOnCreateFn = CachedPropertiesByModel.getMetadataValue(
                this.model.name,
                MetadataKey.DefaultOnCreate,
                property,
            );
            const defaultOnInputFn = CachedPropertiesByModel.getMetadataValue(
                this.model.name,
                MetadataKey.DefaultOnInput,
                property,
            );
            const defaultFn = defaultOnCreateFn || defaultOnInputFn;
            if (!defaultFn) continue;
            input[property] = await defaultFn(context, input);
        }
        return input;
    }

    private async transform(input: any, context: any) {
        const properties = {};
        [MetadataKey.TransformOnCreate, MetadataKey.TransformOnInput].forEach(metaKey => {
            Object.keys(CachedPropertiesByModel.getPropertiesByModel(this.model.name, metaKey)).forEach(
                (property: string) => {
                    properties[property] = true;
                },
            );
        });

        for (const property in properties) {
            if (input[property] === undefined) continue;
            const transformOnCreateFn = CachedPropertiesByModel.getMetadataValue(
                this.model.name,
                MetadataKey.TransformOnCreate,
                property,
            );
            const transformOnInputFn = CachedPropertiesByModel.getMetadataValue(
                this.model.name,
                MetadataKey.TransformOnInput,
                property,
            );
            const transformFn = transformOnCreateFn || transformOnInputFn;
            if (!transformFn) continue;
            input[property] = await transformFn(input[property], context, input);
        }
        return input;
    }
}
