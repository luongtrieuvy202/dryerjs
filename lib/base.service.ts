import * as graphql from 'graphql';
import { Inject, Injectable, Provider } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, PaginateModel } from 'mongoose';
import { Definition } from './definition';
import { inspect } from './inspect';
import { SuccessResponse } from './types';
import * as util from './util';
import { AllDefinitions, Hook } from './hook';
import { MetaKey, Metadata } from './metadata';
import { ObjectId } from './shared';
import { RemoveMode, RemoveOptions } from './remove-options';

export abstract class BaseService<T = any, Context = any> {
  protected model: PaginateModel<T>;
  protected moduleRef: ModuleRef;
  protected definition: Definition;

  protected abstract getHooks: (method: keyof Hook) => Hook[];

  private getHooksWithContext(method: keyof Hook, ctx: Context, definition: Definition): Hook[] {
    return this.getHooks(method).filter((hook) => {
      return util.isNil(hook.shouldApplyForContext) || hook.shouldApplyForContext(ctx, definition);
    });
  }

  public async create(ctx: Context, input: Partial<T>): Promise<T> {
    for (const hook of this.getHooksWithContext('beforeCreate', ctx, this.definition)) {
      await hook.beforeCreate!({ ctx, input, definition: this.definition });
    }

    const created = await this.model.create(input);
    for (const property of inspect(this.definition).referencesManyProperties) {
      if (util.isNil(input[property.name]) || input[property.name].length === 0) continue;
      const relation = property.getReferencesMany();
      const relationDefinition = relation.typeFunction();
      const newIds: string[] = [];
      for (const subObject of input[property.name]) {
        const baseServiceForRelation = this.moduleRef.get(getBaseServiceToken(relationDefinition), {
          strict: false,
        }) as BaseService;
        const createdRelation = await baseServiceForRelation.create(ctx, subObject);
        newIds.push(createdRelation._id);
      }
      await this.model.findByIdAndUpdate(created._id, {
        $addToSet: { [relation.options.from]: { $each: newIds } } as any,
      });
    }
    for (const property of inspect(this.definition).hasOneProperties) {
      if (util.isNil(input[property.name])) continue;
      const relation = property.getHasOne();
      const relationDefinition = relation.typeFunction();
      const baseServiceForRelation = this.moduleRef.get(getBaseServiceToken(relationDefinition), {
        strict: false,
      }) as BaseService;
      await baseServiceForRelation.create(ctx, {
        ...input[property.name],
        [relation.options.to]: created._id,
      });
    }

    for (const property of inspect(this.definition).hasManyProperties) {
      if (util.isNil(input[property.name]) || input[property.name].length === 0) continue;
      const relation = property.getHasMany();
      const relationDefinition = relation.typeFunction();
      for (const subObject of input[property.name]) {
        const baseServiceForRelation = this.moduleRef.get(getBaseServiceToken(relationDefinition), {
          strict: false,
        }) as BaseService;
        await baseServiceForRelation.create(ctx, {
          ...subObject,
          [relation.options.to]: created._id,
        });
      }
    }
    const result = await this.model.findById(created._id);
    for (const hook of this.getHooksWithContext('afterCreate', ctx, this.definition)) {
      await hook.afterCreate!({ ctx, input, created: result, definition: this.definition });
    }
    return result as any;
  }

  public async update(ctx: Context, input: Partial<T> & { id: ObjectId }): Promise<T> {
    const filter = { _id: input.id };
    for (const hook of this.getHooksWithContext('beforeWriteFilter', ctx, this.definition)) {
      await hook.beforeWriteFilter!({ ctx, filter, definition: this.definition });
    }
    const beforeUpdated = await this.findOneWithoutBeforeReadFilter(ctx, filter);
    for (const hook of this.getHooksWithContext('beforeUpdate', ctx, this.definition)) {
      await hook.beforeUpdate!({ ctx, input, beforeUpdated, definition: this.definition });
    }
    const updated = await this.model.findOneAndUpdate({ _id: input.id }, input, { new: true });
    for (const hook of this.getHooksWithContext('afterUpdate', ctx, this.definition)) {
      await hook.afterUpdate!({ ctx, input, updated, beforeUpdated, definition: this.definition });
    }
    return updated!;
  }

  public async findOneWithoutBeforeReadFilter(ctx: Context, filter: FilterQuery<T>): Promise<T> {
    for (const hook of this.getHooksWithContext('beforeFindOne', ctx, this.definition)) {
      await hook.beforeFindOne!({ ctx, filter, definition: this.definition });
    }
    const result = await this.model.findOne(filter);
    if (util.isNil(result)) {
      throw new graphql.GraphQLError(`No ${this.definition.name} found with ID: ${filter._id}`);
    }
    for (const hook of this.getHooksWithContext('afterFindOne', ctx, this.definition)) {
      await hook.afterFindOne!({ ctx, result, filter, definition: this.definition });
    }
    return result;
  }

  public async findOne(ctx: Context, filter: FilterQuery<T>): Promise<T> {
    for (const hook of this.getHooksWithContext('beforeReadFilter', ctx, this.definition)) {
      await hook.beforeReadFilter!({ ctx, filter, definition: this.definition });
    }
    return await this.findOneWithoutBeforeReadFilter(ctx, filter);
  }

  public async findAll(ctx: Context, filter: FilterQuery<T>, sort: object): Promise<T[]> {
    for (const hook of this.getHooksWithContext('beforeReadFilter', ctx, this.definition)) {
      await hook.beforeReadFilter!({ ctx, filter, definition: this.definition });
    }
    for (const hook of this.getHooksWithContext('beforeFindMany', ctx, this.definition)) {
      await hook.beforeFindMany!({ ctx, filter, sort, definition: this.definition });
    }
    const items = await this.model.find(filter).sort(sort as any);
    for (const hook of this.getHooksWithContext('afterFindMany', ctx, this.definition)) {
      await hook.afterFindMany!({ ctx, filter, sort, items, definition: this.definition });
    }
    return items;
  }

  public async remove(
    ctx: Context,
    id: ObjectId,
    options: RemoveOptions = { mode: RemoveMode.RequiredCleanRelations },
  ): Promise<SuccessResponse> {
    const filter = { _id: id };
    for (const hook of this.getHooksWithContext('beforeWriteFilter', ctx, this.definition)) {
      await hook.beforeWriteFilter!({ ctx, filter, definition: this.definition });
    }
    const beforeRemoved = await this.findOneWithoutBeforeReadFilter(ctx, filter);
    for (const hook of this.getHooksWithContext('beforeRemove', ctx, this.definition)) {
      await hook.beforeRemove!({ ctx, beforeRemoved, definition: this.definition, options });
    }
    const removed = await this.model.findByIdAndDelete(id);
    for (const hook of this.getHooksWithContext('afterRemove', ctx, this.definition)) {
      await hook.afterRemove!({ ctx, removed, definition: this.definition, options });
    }
    return { success: true };
  }

  public async paginate(ctx: Context, filter: FilterQuery<T>, sort: object, page: number, limit: number) {
    for (const hook of this.getHooksWithContext('beforeReadFilter', ctx, this.definition)) {
      await hook.beforeReadFilter!({ ctx, filter, definition: this.definition });
    }
    for (const hook of this.getHooksWithContext('beforeFindMany', ctx, this.definition)) {
      await hook.beforeFindMany!({ ctx, filter, sort, page, limit, definition: this.definition });
    }
    const response = await this.model.paginate(filter, { page, limit, sort });
    for (const hook of this.getHooksWithContext('afterFindMany', ctx, this.definition)) {
      await hook.afterFindMany!({
        ctx,
        filter,
        sort,
        items: response.docs,
        page,
        limit,
        definition: this.definition,
      });
    }

    return response;
  }
}

export function createBaseService(definition: Definition, hooks: Provider[]): typeof BaseService {
  @Injectable()
  class GeneratedBaseService extends BaseService<any, any> {
    protected getHooks: (method: keyof Hook) => Hook[];

    constructor(
      @InjectModel(definition.name) public model: PaginateModel<any>,
      public moduleRef: ModuleRef,
    ) {
      super();
      this.definition = definition;
      this.getHooks = util.memoize(this.getHooksUncached.bind(this));
    }

    private getHooksUncached(method: keyof Hook): Hook[] {
      return hooks
        .filter((hook) => {
          const hookDefinition = Metadata.for(hook).get(MetaKey.Hook)();
          if (hookDefinition !== AllDefinitions && hookDefinition !== definition) return false;
          const hookInstance = this.moduleRef.get(hook as any, { strict: false });
          return util.isFunction(hookInstance[method]);
        })
        .map((hook) => this.moduleRef.get(hook as any, { strict: false }) as Hook);
    }
  }

  return GeneratedBaseService as any;
}

export function InjectBaseService(definition: Definition) {
  return Inject(getBaseServiceToken(definition));
}

export function getBaseServiceToken(definition: Definition) {
  return `Base${definition.name}Service`;
}
